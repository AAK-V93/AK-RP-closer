import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  applyExtractorToCrm,
  confirmExtractorFiling,
  extractorGap,
  extractorOneLiner,
  isExtractorJson,
  loadOffersForCrm,
  parseExtractorJson,
} from "@/lib/crm-apply";
import { runExtractor } from "@/lib/extractor";
import { userHasReadyCrm } from "@/lib/offer-commercial";
import { isNonSalesCall } from "@/lib/call-kind";

export type SpeakerRole = { name: string; role: "closer" | "lead" };

/** Compat para correcciones viejas del hub. */
export type CallFiling = {
  callType: string;
  result: string;
  leadName: string;
  company: string;
  offerName: string;
  nextStep: string;
  nextStepAt: string;
  objections: string;
  amountTalked: string;
  decider: string;
  summary: string;
  speakers: SpeakerRole[];
};

export function filingSummaryLines(parsed: CallFiling): string[] {
  return [
    `Lead: ${parsed.leadName || "por confirmar"}${parsed.company ? ` · ${parsed.company}` : ""}`,
    `Oferta: ${parsed.offerName || "por confirmar"}`,
    `Tipo / resultado: ${parsed.callType || "—"} · ${parsed.result || "—"}`,
    parsed.nextStep
      ? `Siguiente: ${parsed.nextStep}${parsed.nextStepAt ? ` (${parsed.nextStepAt})` : ""}`
      : "Siguiente: no quedó claro",
    parsed.objections
      ? `Objeción: ${parsed.objections}`
      : parsed.summary || "Sin objeción clara",
  ];
}

export function trainsBotFromType(callType: string) {
  if (isNonSalesCall(callType)) return false;
  return (
    callType === "cierre" ||
    callType === "seguimiento" ||
    callType === "SHOW" ||
    callType === "CIERRE VENTA" ||
    callType === "ACUERDO SIN PAGO"
  );
}

export async function classifyAndFileCall(
  prisma: PrismaClient,
  userId: string,
  args: {
    source: "fathom" | "upload" | "qc" | "chat";
    sourceId: string;
    title: string;
    transcript: string;
    recordedAt?: Date | null;
  },
) {
  const offers = await loadOffersForCrm(prisma, userId);
  const readyCrm = userHasReadyCrm(offers);
  const fecha = args.recordedAt ? args.recordedAt.toISOString().slice(0, 10) : null;
  const parsed = await runExtractor({
    offers,
    title: args.title,
    fechaLlamada: fecha,
    transcript: args.transcript,
    readyCrm,
  });
  const gap = extractorGap(parsed, readyCrm);
  const auto = !gap;
  const summary = auto ? extractorOneLiner(parsed) : gap.question;

  const row = await prisma.callRecord.upsert({
    where: {
      userId_source_sourceId: {
        userId,
        source: args.source,
        sourceId: args.sourceId,
      },
    },
    create: {
      userId,
      source: args.source,
      sourceId: args.sourceId,
      title: args.title,
      callType: parsed.estado_agenda || "",
      result: "",
      leadName: parsed.cliente_real || "",
      offerName: parsed.producto || "",
      trainsBot: trainsBotFromType(parsed.estado_agenda || ""),
      recordedAt: args.recordedAt || new Date(),
      summary,
      filingStatus: auto ? "confirmed" : "pending",
      filingJson: parsed as unknown as Prisma.InputJsonValue,
      confirmedAt: auto ? new Date() : null,
      estadoAgenda: parsed.estado_agenda || "",
      ventaTotal: parsed.venta_total,
      cashCollected: parsed.cash_collected,
      saldoPendiente: parsed.saldo_pendiente,
      modoPago: parsed.modo_pago || "",
    },
    update: {
      title: args.title,
      callType: parsed.estado_agenda || "",
      leadName: parsed.cliente_real || "",
      offerName: parsed.producto || "",
      trainsBot: trainsBotFromType(parsed.estado_agenda || ""),
      recordedAt: args.recordedAt || undefined,
      summary,
      filingStatus: auto ? "confirmed" : "pending",
      filingJson: parsed as unknown as Prisma.InputJsonValue,
      confirmedAt: auto ? new Date() : null,
      estadoAgenda: parsed.estado_agenda || "",
      ventaTotal: parsed.venta_total,
      cashCollected: parsed.cash_collected,
      saldoPendiente: parsed.saldo_pendiente,
      modoPago: parsed.modo_pago || "",
    },
  });

  if (auto && !isNonSalesCall(parsed.estado_agenda)) {
    await applyExtractorToCrm(prisma, userId, row.id, parsed, offers);
    const { fulfillAgendado } = await import("@/lib/agenda");
    await fulfillAgendado(prisma, userId, {
      leadName: parsed.cliente_real || row.leadName,
      recordedAt: args.recordedAt || row.recordedAt,
      estado: parsed.estado_agenda,
    });
  }

  return {
    ...parsed,
    callRecordId: row.id,
    filingStatus: auto ? "confirmed" : "pending",
    autoApplied: auto,
    gap,
    summary,
  };
}

export async function maybeCreateAlert(
  prisma: PrismaClient,
  userId: string,
  leadId: string,
  leadName: string,
  args: {
    nextStep?: string;
    nextStepAt?: Date | null;
    status?: string;
    amountPaid?: string;
    alertType?: string;
  },
) {
  const type =
    args.alertType?.trim() ||
    (args.status === "cobro"
      ? "PAGO PENDIENTE"
      : args.status === "pagado"
        ? "pago_completo"
        : args.nextStepAt
          ? "OTRO"
          : "");
  if (!type) return null;

  const open = await prisma.leadAlert.findFirst({
    where: { userId, leadId, type, resolvedAt: null },
  });
  if (open) return open;

  const dueAt =
    args.nextStepAt || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const question =
    type === "PAGO PENDIENTE" || type === "cobro"
      ? `¿Entró el pago de ${leadName}?`
      : type === "agendar"
        ? `¿Ya agendaste con ${leadName}?`
        : `¿Hablaste con ${leadName}? ¿Qué pasó?${args.nextStep ? ` (${args.nextStep})` : ""}`;

  return prisma.leadAlert.create({
    data: { userId, leadId, type, question, dueAt },
  });
}

export async function confirmCallFiling(
  prisma: PrismaClient,
  userId: string,
  callRecordId: string,
  corrections?: Partial<CallFiling> & { field?: string; value?: string },
) {
  if (corrections?.field && corrections.value != null) {
    return confirmExtractorFiling(prisma, userId, callRecordId, {
      field: corrections.field,
      value: corrections.value,
    });
  }
  return confirmExtractorFiling(prisma, userId, callRecordId, {
    cliente_real: corrections?.leadName,
    producto: corrections?.offerName,
    acuerdo_seguimiento: corrections?.nextStep,
    proximo_seguimiento: corrections?.nextStepAt,
    notas_crm: corrections?.summary,
    razon_no_cierre: corrections?.objections,
  });
}

export async function skipCallFiling(
  prisma: PrismaClient,
  userId: string,
  callRecordId: string,
) {
  const row = await prisma.callRecord.findFirst({
    where: { id: callRecordId, userId },
  });
  if (!row) return null;
  return prisma.callRecord.update({
    where: { id: row.id },
    data: { filingStatus: "skipped", confirmedAt: new Date() },
  });
}

export async function listPendingFilings(prisma: PrismaClient, userId: string) {
  const offers = await loadOffersForCrm(prisma, userId);
  const readyCrm = userHasReadyCrm(offers);
  const rows = await prisma.callRecord.findMany({
    where: { userId, filingStatus: "pending" },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  return rows.map((row) => {
    if (isExtractorJson(row.filingJson)) {
      const parsed = parseExtractorJson(row.filingJson);
      const gap = extractorGap(parsed, readyCrm);
      return {
        id: row.id,
        title: row.title,
        source: row.source,
        sourceId: row.sourceId,
        question: gap?.question || row.summary,
        field: gap?.field || "",
        line: extractorOneLiner(parsed),
        lines: gap ? [gap.question] : [extractorOneLiner(parsed)],
        filing: {
          leadName: parsed.cliente_real || "",
          offerName: parsed.producto || "",
          callType: parsed.estado_agenda || "",
          result: "",
          company: "",
          nextStep: parsed.acuerdo_seguimiento || "",
          nextStepAt: parsed.proximo_seguimiento || "",
          objections: parsed.razon_no_cierre || "",
          amountTalked: parsed.venta_total != null ? String(parsed.venta_total) : "",
          decider: "",
          summary: parsed.notas_crm || "",
          speakers: [],
        } satisfies CallFiling,
      };
    }
    const parsed = (row.filingJson || {}) as Partial<CallFiling>;
    const filing: CallFiling = {
      callType: parsed.callType || row.callType,
      result: parsed.result || row.result,
      leadName: parsed.leadName || row.leadName,
      company: parsed.company || "",
      offerName: parsed.offerName || row.offerName,
      nextStep: parsed.nextStep || "",
      nextStepAt: parsed.nextStepAt || "",
      objections: parsed.objections || "",
      amountTalked: parsed.amountTalked || "",
      decider: parsed.decider || "",
      summary: parsed.summary || row.summary,
      speakers: parsed.speakers || [],
    };
    return {
      id: row.id,
      title: row.title,
      source: row.source,
      sourceId: row.sourceId,
      question: filingSummaryLines(filing)[0],
      field: "",
      line: filing.summary,
      lines: filingSummaryLines(filing),
      filing,
    };
  });
}
