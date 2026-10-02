import type { Prisma, PrismaClient } from "@prisma/client";
import { inferFollowupDate } from "@/lib/followup-date";

export type ChatLead = {
  id: string;
  name: string;
  offerName: string;
  nextStep: string;
  lastSummary: string;
  amountPaid: string;
};

export type ChatCall = {
  leadName: string;
  acuerdo: string;
  notas: string;
  proximo: string;
};

export type ChatChange = {
  field: "name" | "nextStep" | "nextStepAt" | "cash";
  label: string;
  from: string;
  to: string;
};

export type ChatProposal = {
  leadId: string;
  leadName: string;
  changes: ChatChange[];
};

export type ChatTurn =
  | { kind: "none" }
  | { kind: "answer"; reply: string }
  | { kind: "confirm"; reply: string; proposal: ChatProposal }
  | { kind: "apply"; proposal: ChatProposal }
  | { kind: "drop"; reply: string };

export type ChatContext = {
  leads: ChatLead[];
  calls: ChatCall[];
  pending: ChatProposal | null;
  now?: Date;
};

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function leadInMessage(leads: ChatLead[], text: string) {
  const folded = fold(text);
  if (!folded) return null;
  const contained = leads
    .filter((lead) => {
      const name = fold(lead.name);
      return name.length >= 3 && folded.includes(name);
    })
    .sort((a, b) => fold(b.name).length - fold(a.name).length);
  if (contained[0]) return contained[0];
  const tokens = new Set(folded.split(" ").filter((part) => part.length >= 4));
  const byFirst = leads.filter((lead) => {
    const first = fold(lead.name).split(" ")[0] || "";
    return first.length >= 4 && tokens.has(first);
  });
  return byFirst.length === 1 ? byFirst[0] : null;
}

export function exactOfferName(names: string[], raw: string) {
  const needle = fold(raw);
  if (!needle) return "";
  return names.find((name) => fold(name) === needle) || "";
}

export function looksLikeFilingAnswer(text: string) {
  const raw = text.trim();
  if (!raw || raw.length > 80) return false;
  if (/[?]/.test(raw)) return false;
  if (
    /se llama|transcript|quedamos|pag[oó]|pagu[eé]|en realidad|revisa|recuerdo|\boferta\b/i.test(
      raw,
    )
  ) {
    return false;
  }
  return true;
}

export function messageTargetsOtherLead(
  text: string,
  leads: ChatLead[],
  pendingLeadName: string,
) {
  const hit = leadInMessage(leads, text);
  if (!hit) return false;
  const pending = fold(pendingLeadName);
  if (!pending) return true;
  return fold(hit.name) !== pending && !fold(hit.name).startsWith(pending);
}

function isYes(text: string) {
  return /^(s[ií]|confirmo|confirmar|dale|ok|hazlo|adelante)[.!]?$/i.test(text.trim());
}

function isNo(text: string) {
  return /^(no|no confirmo|cancela|cancelar)[.!]?$/i.test(text.trim());
}

function confirmReply(leadName: string, changes: ChatChange[]) {
  const bits = changes.map(
    (change) =>
      `${change.label} de ${leadName} de «${change.from || "—"}» a «${change.to}»`,
  );
  return `Voy a cambiar: ${bits.join("; ")}. ¿Confirmo?`;
}

function parseMoney(raw: string) {
  const digits = raw.replace(/[^\d.,]/g, "").trim();
  if (!digits) return null;
  const normalized = /^\d{1,3}(\.\d{3})+$/.test(digits)
    ? digits.replace(/\./g, "")
    : digits.replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000) return null;
  return String(Math.round(amount));
}

function tidyName(raw: string) {
  return raw.replace(/[.?!]+$/g, "").replace(/\s+/g, " ").trim();
}

function recall(text: string, ctx: ChatContext): ChatTurn | null {
  if (!/no recuerdo|en qu[eé] qued|qu[eé] quedamos|revisa el transcript|revisa el acuerdo/i.test(text)) {
    return null;
  }
  const lead = leadInMessage(ctx.leads, text);
  if (!lead) {
    return { kind: "answer", reply: "¿De quién? Dime el nombre del lead." };
  }
  const folded = fold(lead.name);
  const call =
    ctx.calls.find((row) => fold(row.leadName) === folded && (row.acuerdo || row.notas)) ||
    ctx.calls.find((row) => fold(row.leadName) === folded);
  const acuerdo = call?.acuerdo || lead.nextStep || "";
  const notas = call?.notas || lead.lastSummary || "";
  const kept = acuerdo || notas;
  if (!kept) {
    return {
      kind: "answer",
      reply: `No tengo un acuerdo guardado de ${lead.name} y no hay un transcript enlazado.`,
    };
  }
  const lines = [`Con ${lead.name} quedó: «${kept}».`];
  if (call?.proximo) lines.push(`Próximo seguimiento: ${call.proximo}.`);
  if (notas && acuerdo && notas !== acuerdo) lines.push(`Notas: ${notas}.`);
  lines.push("No hay un transcript enlazado; esto sale de lo guardado en el CRM.");
  return { kind: "answer", reply: lines.join(" ") };
}

function rename(text: string, ctx: ChatContext): ChatTurn | null {
  const match =
    text.match(/^(.+?)\s+en realidad se llama\s+(.+)$/i) ||
    text.match(/^(.+?)\s+ahora se llama\s+(.+)$/i) ||
    text.match(/^(.+?)\s+se llama\s+(.+)$/i);
  if (!match) return null;
  const lead = leadInMessage(ctx.leads, match[1]);
  const next = tidyName(match[2]);
  if (!lead || !next || next.length > 80 || fold(next) === fold(lead.name)) {
    if (lead && next && fold(next) === fold(lead.name)) {
      return { kind: "answer", reply: `${lead.name} ya está guardado con ese nombre.` };
    }
    return null;
  }
  const proposal: ChatProposal = {
    leadId: lead.id,
    leadName: lead.name,
    changes: [{ field: "name", label: "Nombre", from: lead.name, to: next }],
  };
  return { kind: "confirm", reply: confirmReply(lead.name, proposal.changes), proposal };
}

function schedule(text: string, ctx: ChatContext): ChatTurn | null {
  const match = text.match(
    /^(?:con\s+)?(.+?)\s+quedamos(?:\s+de\s+vernos|\s+en\s+vernos|\s+para)?\s+(.+)$/i,
  );
  if (!match) return null;
  const lead = leadInMessage(ctx.leads, match[1]) || leadInMessage(ctx.leads, text);
  if (!lead) return { kind: "answer", reply: "¿Con quién quedaste? Dime el nombre." };
  const when = inferFollowupDate(match[2], ctx.now || new Date());
  if (!when) {
    return {
      kind: "answer",
      reply: `No entendí la fecha con ${lead.name}. Dila como «9 de octubre a las 5 pm».`,
    };
  }
  const spoken = tidyName(match[2]);
  const proposal: ChatProposal = {
    leadId: lead.id,
    leadName: lead.name,
    changes: [
      {
        field: "nextStep",
        label: "Acuerdo",
        from: lead.nextStep,
        to: `Vernos ${spoken}`,
      },
      {
        field: "nextStepAt",
        label: "Próximo seguimiento",
        from: "",
        to: when,
      },
    ],
  };
  return { kind: "confirm", reply: confirmReply(lead.name, proposal.changes), proposal };
}

function payment(text: string, ctx: ChatContext): ChatTurn | null {
  const match = text.match(
    /^(.+?)\s+me pag[oó](?:\s+la\s+reserva)?(?:\s+de)?\s*(?:usd\s*)?(\d[\d.\s]*)/i,
  );
  if (!match) return null;
  const lead = leadInMessage(ctx.leads, match[1]) || leadInMessage(ctx.leads, text);
  const amount = parseMoney(match[2]);
  if (!lead) return { kind: "answer", reply: "¿Quién pagó? Dime el nombre del lead." };
  if (!amount) return { kind: "answer", reply: `¿Cuánto pagó ${lead.name}?` };
  const proposal: ChatProposal = {
    leadId: lead.id,
    leadName: lead.name,
    changes: [
      {
        field: "cash",
        label: "Cash cobrado",
        from: lead.amountPaid || "—",
        to: amount,
      },
    ],
  };
  return { kind: "confirm", reply: confirmReply(lead.name, proposal.changes), proposal };
}

/** Read the current message only. Never writes. A later "sí" applies the stored proposal. */
export function interpretCrmChat(text: string, ctx: ChatContext): ChatTurn {
  const raw = text.trim();
  if (!raw) return { kind: "none" };
  if (ctx.pending && isYes(raw)) return { kind: "apply", proposal: ctx.pending };
  if (ctx.pending && isNo(raw)) {
    return { kind: "drop", reply: "No cambié nada." };
  }
  return recall(raw, ctx) || rename(raw, ctx) || schedule(raw, ctx) || payment(raw, ctx) || { kind: "none" };
}

export function readPendingChat(prefs: unknown): ChatProposal | null {
  if (!prefs || typeof prefs !== "object") return null;
  const raw = (prefs as Record<string, unknown>).pendingChat;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as ChatProposal;
  if (!row.leadId || !Array.isArray(row.changes) || row.changes.length === 0) return null;
  return row;
}

export async function savePendingChat(
  prisma: PrismaClient,
  userId: string,
  proposal: ChatProposal | null,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmPrefs: true },
  });
  const prefs = {
    ...((user?.crmPrefs && typeof user.crmPrefs === "object"
      ? user.crmPrefs
      : {}) as Record<string, unknown>),
  };
  if (proposal) prefs.pendingChat = proposal;
  else delete prefs.pendingChat;
  await prisma.user.update({
    where: { id: userId },
    data: { crmPrefs: prefs as Prisma.InputJsonValue },
  });
}

export async function applyChatProposal(
  prisma: PrismaClient,
  userId: string,
  proposal: ChatProposal,
) {
  const lead = await prisma.lead.findFirst({
    where: { id: proposal.leadId, userId },
  });
  if (!lead) return "No encontré ese lead. No cambié nada.";
  const data: {
    name?: string;
    nextStep?: string;
    nextStepAt?: Date;
    amountPaid?: string;
  } = {};
  let nextName = lead.name;
  for (const change of proposal.changes) {
    if (change.field === "name" && change.to.trim()) {
      nextName = change.to.trim();
      data.name = nextName;
    }
    if (change.field === "nextStep") data.nextStep = change.to;
    if (change.field === "nextStepAt") {
      const iso = change.to.includes("T") ? change.to : change.to.replace(" ", "T");
      const date = new Date(iso.length === 16 ? `${iso}:00.000Z` : iso);
      if (!Number.isNaN(date.getTime())) data.nextStepAt = date;
    }
    if (change.field === "cash") data.amountPaid = change.to;
  }
  await prisma.lead.update({ where: { id: lead.id }, data });
  if (nextName !== lead.name) {
    await prisma.callRecord.updateMany({
      where: { userId, leadName: lead.name },
      data: { leadName: nextName },
    });
  }
  const call = await prisma.callRecord.findFirst({
    where: { userId, leadName: nextName },
    orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
  });
  if (call) {
    const filing =
      call.filingJson && typeof call.filingJson === "object"
        ? { ...(call.filingJson as Record<string, unknown>) }
        : {};
    if (nextName !== lead.name) filing.cliente_real = nextName;
    const step = proposal.changes.find((change) => change.field === "nextStep");
    const when = proposal.changes.find((change) => change.field === "nextStepAt");
    const cash = proposal.changes.find((change) => change.field === "cash");
    if (step) filing.acuerdo_seguimiento = step.to;
    if (when) filing.proximo_seguimiento = when.to;
    const cashAmount = cash ? Number(cash.to) : null;
    if (cashAmount != null && Number.isFinite(cashAmount)) filing.cash_collected = cashAmount;
    await prisma.callRecord.update({
      where: { id: call.id },
      data: {
        leadName: nextName,
        ...(cashAmount != null && Number.isFinite(cashAmount)
          ? { cashCollected: cashAmount }
          : {}),
        filingJson: filing as Prisma.InputJsonValue,
      },
    });
  }
  const done = proposal.changes.map((change) => `${change.label} «${change.to}»`).join("; ");
  return `Listo. En ${nextName} quedó: ${done}.`;
}
