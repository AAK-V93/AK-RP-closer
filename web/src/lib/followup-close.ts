import { Prisma, type PrismaClient } from "@prisma/client";
import { applyAlertOutcome, resolveOpenAlertsForLead, type AlertOutcome } from "@/lib/alerts";
import { dueDayFromProximo, foldLeadName, followupIsClosed } from "@/lib/crm-followups";
import { findMatchingLead } from "@/lib/lead-match";
import {
  instantFromProximo,
  normalizeFollowupUndo,
  normalizeFollowupWhen,
  proximoFromInstant,
  restoreFollowupFiling,
  RESCHEDULE_RESULTS,
  type DeskResultado,
  type FollowupUndo,
} from "@/lib/followup-desk";

export type { DeskResultado } from "@/lib/followup-desk";
export {
  addCalendarDays,
  deskUndoMessage,
  projectDeskRows,
  projectOperacionProximo,
  suggestNextFollowup,
} from "@/lib/followup-desk";
export { followupIsClosed } from "@/lib/crm-followups";

const RESCHEDULE = new Set<string>(RESCHEDULE_RESULTS);
const THREAD_SENSITIVE = new Set(["mostro", "no_mostro"]);

type Filing = Record<string, unknown>;

function filingBase(raw: unknown): Filing {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Filing) } : {};
}

function proximoOf(filing: Filing) {
  return String(filing.proximo_seguimiento || "").trim();
}

function requiereOf(filing: Filing): boolean | null {
  if (filing.requiere_seguimiento === true) return true;
  if (filing.requiere_seguimiento === false) return false;
  return null;
}

type CallRow = {
  id: string;
  leadName: string;
  filingJson: unknown;
  recordedAt: Date | null;
  createdAt: Date;
};

function callName(call: CallRow) {
  const filing = filingBase(call.filingJson);
  return String(call.leadName || filing.cliente_real || "").trim();
}

type CallUndo = {
  id: string;
  proximo: string;
  resultado: string;
  cerrado: string;
  intentos: number;
  requiere: boolean | null;
};

type DeskUndo = {
  calls: CallUndo[];
  resolvedAlertIds: string[];
  spawnedAlertIds: string[];
  threads: { id: string; estado: string; pasoActual: number; askLost: boolean }[];
  spawnedThreadIds: string[];
  lead: { id: string; status: string; nextStepAt: string | null; razonNoCierre: string } | null;
  touchedAfter: string;
};

export async function applyDeskFollowup(
  prisma: PrismaClient,
  userId: string,
  args: {
    alertId: string;
    resultado: DeskResultado;
    nextAt?: string;
    amount?: number;
    nota?: string;
    razonNoCierre?: string;
  },
) {
  const resolved = await resolveTarget(prisma, userId, args.alertId);
  if (!resolved) return { error: "No encontré ese seguimiento." as const };

  const calls = await loadCalls(prisma, userId);
  const cliente = resolved.alert?.lead.name || callName(calls.find((row) => row.id === resolved.explicitCallId) || {
    id: "",
    leadName: "",
    filingJson: {},
    recordedAt: null,
    createdAt: new Date(0),
  });
  const key = foldLeadName(cliente);
  const matches = calls.filter(
    (call) => call.id === resolved.explicitCallId || (key && foldLeadName(callName(call)) === key),
  );
  if (!matches.length) return { error: "No encontré ese seguimiento." as const };

  const winning = matches.find((call) => dueDayFromProximo(proximoOf(filingBase(call.filingJson)))) || matches[0];
  const previousProximo = proximoOf(filingBase(winning.filingJson));
  const scheduled = RESCHEDULE.has(args.resultado)
    ? normalizeFollowupWhen(args.nextAt || "", previousProximo)
    : null;
  if (RESCHEDULE.has(args.resultado) && !scheduled) {
    return { error: "Elige una fecha para el próximo seguimiento." as const };
  }

  const lead = await resolveLead(prisma, userId, resolved.alert?.lead || null, cliente);
  const leadId = lead?.id || resolved.alert?.leadId || "";

  if (alreadyClosed(winning, args.resultado) && !(resolved.alert && !resolved.alert.resolvedAt)) {
    return {
      ok: true as const,
      already: true as const,
      leavesList: true,
      proximo: "",
      cliente,
      callId: winning.id,
    };
  }

  const undo = await snapshotUndo(prisma, userId, matches, leadId, lead);
  const openBeforeIds = new Set(undo.resolvedAlertIds);

  let didApply = false;
  if (resolved.alert && !resolved.alert.resolvedAt) {
    const threaded = Boolean(resolved.alert.threadId);
    if (!THREAD_SENSITIVE.has(args.resultado) || threaded) {
      didApply = true;
      const out = await applyAlertOutcome(prisma, userId, resolved.alert.id, {
        resultado: args.resultado as AlertOutcome,
        nextAt: scheduled ? instantFromProximo(scheduled)?.toISOString() : undefined,
        amount: args.amount,
        nota: args.nota,
        razonNoCierre: args.razonNoCierre,
      });
      if ("error" in out && out.error) return { error: "No se guardó. Inténtalo otra vez." as const };
    }
  } else if (args.resultado === "perdido" && leadId) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: "perdido", razonNoCierre: args.razonNoCierre || args.nota || "perdido" },
    });
    await resolveOpenAlertsForLead(prisma, userId, leadId);
  }

  const open = didApply && leadId
    ? await prisma.leadAlert.findFirst({
        where: { userId, leadId, resolvedAt: null },
        orderBy: { createdAt: "desc" },
      })
    : null;

  let proximo = "";
  let closed = false;
  if (scheduled) {
    proximo = scheduled;
    if (open) {
      const due = instantFromProximo(scheduled);
      if (due) {
        await prisma.leadAlert.update({ where: { id: open.id }, data: { dueAt: due } });
      }
    }
  } else if (open) {
    proximo = proximoFromInstant(open.dueAt);
  } else {
    closed = true;
  }

  const afterThreads = leadId
    ? await prisma.followupThread.findMany({ where: { userId, leadId } })
    : [];
  const beforeThreadIds = new Set(undo.threads.map((row) => row.id));
  undo.spawnedThreadIds = afterThreads
    .filter((row) => !beforeThreadIds.has(row.id))
    .map((row) => row.id);
  if (leadId) {
    const openAfter = await prisma.leadAlert.findMany({
      where: { userId, leadId, resolvedAt: null },
      select: { id: true },
    });
    const stillOpen = new Set(openAfter.map((row) => row.id));
    undo.resolvedAlertIds = [...openBeforeIds].filter((id) => !stillOpen.has(id));
    undo.spawnedAlertIds = openAfter
      .map((row) => row.id)
      .filter((id) => !openBeforeIds.has(id));
  }

  await writeCalls(prisma, matches, winning.id, {
    proximo,
    resultado: closed ? args.resultado : RESCHEDULE.has(args.resultado) ? args.resultado : "",
    closed,
    undo,
  });

  if (leadId) {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        nextStepAt: proximo ? instantFromProximo(proximo) : null,
        ...(args.resultado === "perdido"
          ? { status: "perdido", razonNoCierre: args.razonNoCierre || args.nota || "perdido" }
          : {}),
      },
    });
  }

  return {
    ok: true as const,
    leavesList: closed,
    proximo,
    cliente,
    callId: winning.id,
  };
}

export async function reopenDeskFollowup(prisma: PrismaClient, userId: string, rawId: string) {
  const resolved = await resolveTarget(prisma, userId, rawId);
  if (!resolved) return { error: "No encontré ese seguimiento." as const };
  const calls = await loadCalls(prisma, userId);
  const seed = calls.find((row) => row.id === resolved.explicitCallId) || null;
  const cliente = resolved.alert?.lead.name || (seed ? callName(seed) : "");
  const key = foldLeadName(cliente);
  const matches = calls.filter(
    (call) => call.id === resolved.explicitCallId || (key && foldLeadName(callName(call)) === key),
  );
  const undoOf = (call: CallRow) => normalizeFollowupUndo(filingBase(call.filingJson).seguimiento_undo);
  const host =
    matches.find((call) => call.id === resolved.explicitCallId && undoOf(call)) ||
    matches.find((call) => undoOf(call)) ||
    matches.find((call) => dueDayFromProximo(String(filingBase(call.filingJson).seguimiento_cerrado || ""))) ||
    null;
  if (!host) return { error: "No hay nada que deshacer." as const };
  const undo = undoOf(host);

  const restored = await restoreClosedCalls(prisma, matches.length ? matches : [host], undo);
  if (!restored) return { error: "No hay nada que deshacer." as const };

  if (undo) await restoreUndoSideEffects(prisma, userId, undo);
  return { ok: true as const, cliente, callId: host.id, proximo: restored };
}

async function restoreClosedCalls(
  prisma: PrismaClient,
  calls: CallRow[],
  undo: FollowupUndo | null,
) {
  let proximo = "";
  for (const call of calls) {
    const filing = filingBase(call.filingJson);
    const snap = undo?.calls.find((row) => row.id === call.id) || null;
    const next = restoreFollowupFiling(filing, snap);
    if (!next.restored) continue;
    proximo = next.proximo || proximo;
    await prisma.callRecord.update({
      where: { id: call.id },
      data: { filingJson: next.filing as Prisma.InputJsonValue },
    });
  }
  return proximo;
}

/** One row at a time. Neon HTTP rejects updateMany/deleteMany because they open a transaction. */
async function restoreUndoSideEffects(prisma: PrismaClient, userId: string, undo: FollowupUndo) {
  const step = async (label: string, job: () => Promise<unknown>) => {
    try {
      await job();
    } catch (error) {
      console.error("reabrir", label, error);
    }
  };
  for (const id of undo.spawnedAlertIds) {
    await step(`alerta nueva ${id}`, async () => {
      const row = await prisma.leadAlert.findFirst({ where: { id, userId }, select: { id: true } });
      if (row) await prisma.leadAlert.delete({ where: { id: row.id } });
    });
  }
  for (const id of undo.spawnedThreadIds) {
    await step(`hilo nuevo ${id}`, async () => {
      const row = await prisma.followupThread.findFirst({ where: { id, userId }, select: { id: true } });
      if (row) await prisma.followupThread.delete({ where: { id: row.id } });
    });
  }
  for (const id of undo.resolvedAlertIds) {
    await step(`alerta ${id}`, async () => {
      const row = await prisma.leadAlert.findFirst({ where: { id, userId }, select: { id: true } });
      if (!row) return;
      await prisma.leadAlert.update({
        where: { id: row.id },
        data: { resolvedAt: null, resultado: "", resultadoNota: "" },
      });
    });
  }
  for (const thread of undo.threads) {
    await step(`hilo ${thread.id}`, async () => {
      const row = await prisma.followupThread.findFirst({
        where: { id: thread.id, userId },
        select: { id: true },
      });
      if (!row) return;
      await prisma.followupThread.update({
        where: { id: row.id },
        data: {
          estado: thread.estado,
          pasoActual: thread.pasoActual,
          askLost: thread.askLost,
        },
      });
    });
  }
  const touched = undo.touchedAfter ? new Date(undo.touchedAfter) : null;
  if (touched && !Number.isNaN(touched.getTime()) && undo.threads.length) {
    await step("toques", async () => {
      const touches = await prisma.followupTouch.findMany({
        where: { threadId: { in: undo.threads.map((row) => row.id) }, fecha: { gte: touched } },
        select: { id: true },
      });
      for (const touch of touches) {
        await prisma.followupTouch.delete({ where: { id: touch.id } });
      }
    });
  }
  if (undo.lead) {
    const nextStep = undo.lead.nextStepAt ? new Date(undo.lead.nextStepAt) : null;
    await step("lead", async () => {
      const row = await prisma.lead.findFirst({
        where: { id: undo.lead?.id, userId },
        select: { id: true },
      });
      if (!row) return;
      await prisma.lead.update({
        where: { id: row.id },
        data: {
          status: undo.lead?.status || "",
          razonNoCierre: undo.lead?.razonNoCierre || "",
          nextStepAt: nextStep && !Number.isNaN(nextStep.getTime()) ? nextStep : null,
        },
      });
    });
  }
}

async function resolveTarget(prisma: PrismaClient, userId: string, rawId: string) {
  const id = rawId.trim();
  if (!id) return null;
  if (id.startsWith("call:")) {
    const call = await prisma.callRecord.findFirst({
      where: { id: id.slice("call:".length), userId },
      select: { id: true },
    });
    return call ? { alert: null, explicitCallId: call.id } : null;
  }
  const alert = await prisma.leadAlert.findFirst({
    where: { id, userId },
    include: { lead: true },
  });
  if (alert) return { alert, explicitCallId: alert.callRecordId };
  const call = await prisma.callRecord.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  return call ? { alert: null, explicitCallId: call.id } : null;
}

async function loadCalls(prisma: PrismaClient, userId: string): Promise<CallRow[]> {
  return prisma.callRecord.findMany({
    where: { userId, filingStatus: { not: "skipped" } },
    orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
    take: 2000,
    select: {
      id: true,
      leadName: true,
      filingJson: true,
      recordedAt: true,
      createdAt: true,
    },
  });
}

async function resolveLead(
  prisma: PrismaClient,
  userId: string,
  known: { id: string; name: string; company: string; status: string; razonNoCierre: string; nextStepAt: Date | null } | null,
  cliente: string,
) {
  if (known) return known;
  if (!foldLeadName(cliente)) return null;
  const leads = await prisma.lead.findMany({ where: { userId } });
  return findMatchingLead(leads, cliente);
}

function alreadyClosed(call: CallRow, action: string) {
  const filing = filingBase(call.filingJson);
  return followupIsClosed(filing) && String(filing.seguimiento_resultado || "").toLowerCase() === action;
}

async function snapshotUndo(
  prisma: PrismaClient,
  userId: string,
  matches: CallRow[],
  leadId: string,
  lead: { id: string; status: string; razonNoCierre: string; nextStepAt: Date | null } | null,
): Promise<DeskUndo> {
  const open = leadId
    ? await prisma.leadAlert.findMany({
        where: { userId, leadId, resolvedAt: null },
        select: { id: true },
      })
    : [];
  const threads = leadId
    ? await prisma.followupThread.findMany({
        where: { userId, leadId },
        select: { id: true, estado: true, pasoActual: true, askLost: true },
      })
    : [];
  return {
    calls: matches.map((call) => {
      const filing = filingBase(call.filingJson);
      return {
        id: call.id,
        proximo: proximoOf(filing),
        resultado: String(filing.seguimiento_resultado || ""),
        cerrado: String(filing.seguimiento_cerrado || ""),
        intentos: Number(filing.seguimiento_intentos || 0) || 0,
        requiere: requiereOf(filing),
      };
    }),
    resolvedAlertIds: open.map((row) => row.id),
    spawnedAlertIds: [],
    threads,
    spawnedThreadIds: [],
    lead: lead
      ? {
          id: lead.id,
          status: lead.status,
          nextStepAt: lead.nextStepAt ? lead.nextStepAt.toISOString() : null,
          razonNoCierre: lead.razonNoCierre,
        }
      : null,
    touchedAfter: new Date().toISOString(),
  };
}

async function writeCalls(
  prisma: PrismaClient,
  matches: CallRow[],
  winningId: string,
  args: { proximo: string; resultado: string; closed: boolean; undo: DeskUndo },
) {
  for (const call of matches) {
    const filing = filingBase(call.filingJson);
    const hadDate = Boolean(dueDayFromProximo(proximoOf(filing)));
    const isWinning = call.id === winningId;
    if (!args.closed && !isWinning) continue;
    if (args.closed && !hadDate && !isWinning) continue;
    const intentos = Number(filing.seguimiento_intentos || 0) || 0;
    if (args.closed) {
      filing.seguimiento_cerrado = hadDate ? proximoOf(filing) : String(filing.seguimiento_cerrado || "");
      filing.proximo_seguimiento = "";
      filing.requiere_seguimiento = false;
      filing.seguimiento_resultado = args.resultado;
    } else {
      filing.proximo_seguimiento = args.proximo;
      filing.requiere_seguimiento = true;
      filing.seguimiento_resultado = args.resultado;
      filing.seguimiento_cerrado = "";
      if (RESCHEDULE.has(args.resultado)) filing.seguimiento_intentos = intentos + 1;
    }
    if (isWinning) filing.seguimiento_undo = args.undo;
    else delete filing.seguimiento_undo;
    await prisma.callRecord.update({
      where: { id: call.id },
      data: { filingJson: filing as Prisma.InputJsonValue },
    });
  }
}
