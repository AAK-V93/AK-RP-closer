import type { PrismaClient } from "@prisma/client";
import { foldLeadName } from "@/lib/crm-followups";
import { statusFromEstadoAgenda } from "@/lib/crm-activa";
import { isInternalNoise, realClientName } from "@/lib/crm-noise";
import { instantFromProximo } from "@/lib/followup-desk";
import { findMatchingLead } from "@/lib/lead-match";
import { plainStatus } from "@/lib/plain-labels";
import { zonedDayKey } from "@/lib/crm-time";

type Filing = Record<string, unknown>;

export type RemainingCall = {
  id: string;
  leadName?: string | null;
  title?: string | null;
  estadoAgenda?: string | null;
  recordedAt?: Date | string | null;
  createdAt?: Date | string | null;
  filingJson?: unknown;
  summary?: string | null;
};

function filingOf(raw: unknown): Filing {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Filing) : {};
}

function asText(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "null") return "";
  return text;
}

function stamp(value: Date | string | null | undefined) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function callCliente(call: RemainingCall) {
  const filing = filingOf(call.filingJson);
  return asText(call.leadName) || asText(filing.cliente_real);
}

/** Newest remaining commercial row becomes the lead's próximo and estado. */
export function leadStateFromRemaining(calls: RemainingCall[]) {
  const commercial = calls
    .filter((call) => {
      const filing = filingOf(call.filingJson);
      return !isInternalNoise({
        cliente: callCliente(call),
        estadoAgenda: asText(call.estadoAgenda) || asText(filing.estado_agenda),
        title: call.title,
      });
    })
    .slice()
    .sort((a, b) => stamp(b.recordedAt || b.createdAt) - stamp(a.recordedAt || a.createdAt));
  const latest = commercial[0];
  if (!latest) {
    return { status: "nuevo", nextStep: "", nextStepAt: null as Date | null, proximo: "" };
  }
  const filing = filingOf(latest.filingJson);
  const estado = asText(latest.estadoAgenda) || asText(filing.estado_agenda);
  const proximo = asText(filing.proximo_seguimiento).replace("T", " ").slice(0, 16);
  const acuerdo = asText(filing.acuerdo_seguimiento);
  const tipo = plainStatus(asText(filing.tipo_seguimiento));
  return {
    status: statusFromEstadoAgenda(estado),
    nextStep: acuerdo || (tipo !== "—" ? tipo : ""),
    nextStepAt: proximo ? instantFromProximo(proximo) : null,
    proximo,
  };
}

/**
 * Deletes one Operación row and rebuilds that lead's próximo/estado
 * from the calls that remain. Neon HTTP: one write at a time, no transaction.
 */
export async function deleteOperacionRow(prisma: PrismaClient, userId: string, callId: string) {
  const id = String(callId || "").trim();
  if (!id) return { error: "Falta la fila." as const };
  const call = await prisma.callRecord.findFirst({ where: { id, userId } });
  if (!call) return { error: "No encontré esa fila." as const };

  const cliente = callCliente(call);
  const named = realClientName(cliente);
  const leads = await prisma.lead.findMany({ where: { userId } });
  const lead = named
    ? findMatchingLead(
        leads.map((row) => ({ id: row.id, name: row.name, company: row.company || "" })),
        named,
      )
    : null;
  const key = foldLeadName(named);
  const all = await prisma.callRecord.findMany({ where: { userId } });
  const remaining = key
    ? all.filter((row) => row.id !== call.id && foldLeadName(callCliente(row)) === key)
    : [];
  const next = leadStateFromRemaining(remaining);

  await prisma.callRecord.delete({ where: { id: call.id } });

  const tied = await prisma.leadAlert.findMany({
    where: { userId, callRecordId: call.id },
    select: { id: true },
  });
  for (const alert of tied) {
    await prisma.leadAlert.delete({ where: { id: alert.id } });
  }

  const commissions = await prisma.commission.findMany({
    where: { userId, callRecordId: call.id },
    select: { id: true },
  });
  for (const row of commissions) {
    await prisma.commission.delete({ where: { id: row.id } });
  }

  if (lead) {
    const threads = await prisma.followupThread.findMany({
      where: { userId, leadId: lead.id, creadoDesdeCallRecordId: call.id },
      select: { id: true },
    });
    for (const thread of threads) {
      await prisma.followupThread.update({
        where: { id: thread.id },
        data: { estado: "cerrado" },
      });
      const open = await prisma.leadAlert.findMany({
        where: { userId, threadId: thread.id, resolvedAt: null },
        select: { id: true },
      });
      const resolvedAt = new Date();
      for (const alert of open) {
        await prisma.leadAlert.update({
          where: { id: alert.id },
          data: { resolvedAt },
        });
      }
    }
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: next.status,
        nextStep: next.nextStep,
        nextStepAt: next.nextStepAt,
      },
    });
  }

  const fecha = call.recordedAt ? zonedDayKey(call.recordedAt) : "";
  return {
    ok: true as const,
    cliente: named || cliente,
    fecha,
    status: lead ? next.status : "",
    nextStep: lead ? next.nextStep : "",
    proximo: lead ? next.proximo : "",
  };
}
