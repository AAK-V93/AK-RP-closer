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
import { emptyExtractor, enrichExtractorFollowup, runExtractor } from "@/lib/extractor";
import { userHasReadyCrm } from "@/lib/offer-commercial";
import { isNonSalesCall } from "@/lib/call-kind";
import { classifyCallIntake, isInternalMeetingTitle } from "@/lib/call-intake";
import {
  loadExtractorPattern,
  matchesLearnedNonCommercial,
  recordExtractorFeedback,
} from "@/lib/extractor-feedback";

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
    durationMs?: number | null;
  },
) {
  const intake = classifyCallIntake({
    title: args.title,
    transcript: args.transcript,
    durationMs: args.durationMs,
  });
  if (intake.action === "skip") {
    return fileSkipped(prisma, userId, args, {
      estado: intake.estado,
      note:
        intake.reason === "no_transcript"
          ? "Sin transcripción real. No va al extractor."
          : intake.reason === "short"
            ? "Reunión de menos de 5 minutos. No entra al CRM."
            : "Reunión interna. No entra al CRM.",
    });
  }

  const pattern = await loadExtractorPattern(prisma, userId);
  if (matchesLearnedNonCommercial(args.title, pattern)) {
    return fileSkipped(prisma, userId, args, {
      estado: "NO_COMERCIAL",
      note: "Aprendido de tus correcciones: este título no es comercial.",
    });
  }

  const offers = await loadOffersForCrm(prisma, userId);
  const readyCrm = userHasReadyCrm(offers);
  const fecha = args.recordedAt ? args.recordedAt.toISOString().slice(0, 10) : null;
  const parsed = enrichExtractorFollowup(
    await runExtractor({
      offers,
      title: args.title,
      fechaLlamada: fecha,
      transcript: args.transcript,
      readyCrm,
      hints: pattern?.summary || null,
    }),
    { transcript: args.transcript, callAt: args.recordedAt },
  );
  const nonSales = isNonSalesCall(parsed.estado_agenda);
  const gap = nonSales ? null : extractorGap(parsed, readyCrm);
  const auto = !gap;
  const summary = auto ? extractorOneLiner(parsed) : gap?.question || extractorOneLiner(parsed);
  const filingStatus = nonSales ? "skipped" : auto ? "confirmed" : "pending";

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
      filingStatus,
      filingJson: parsed as unknown as Prisma.InputJsonValue,
      confirmedAt: auto || nonSales ? new Date() : null,
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
      filingStatus,
      filingJson: parsed as unknown as Prisma.InputJsonValue,
      confirmedAt: auto || nonSales ? new Date() : null,
      estadoAgenda: parsed.estado_agenda || "",
      ventaTotal: parsed.venta_total,
      cashCollected: parsed.cash_collected,
      saldoPendiente: parsed.saldo_pendiente,
      modoPago: parsed.modo_pago || "",
    },
  });

  if (auto && !nonSales) {
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
    filingStatus,
    autoApplied: auto && !nonSales,
    gap,
    summary,
  };
}

async function fileSkipped(
  prisma: PrismaClient,
  userId: string,
  args: {
    source: "fathom" | "upload" | "qc" | "chat";
    sourceId: string;
    title: string;
    recordedAt?: Date | null;
  },
  skipped: { estado: "INTERNA" | "NO_COMERCIAL"; note: string },
) {
  const parsed = emptyExtractor();
  parsed.estado_agenda = skipped.estado;
  parsed.requiere_seguimiento = false;
  parsed.confianza.estado_agenda = 100;
  parsed.notas_crm = skipped.note;
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
      leadName: "",
      trainsBot: false,
      recordedAt: args.recordedAt || new Date(),
      summary: skipped.note,
      filingStatus: "skipped",
      filingJson: parsed as unknown as Prisma.InputJsonValue,
      confirmedAt: new Date(),
      estadoAgenda: parsed.estado_agenda || "",
    },
    update: {
      title: args.title,
      callType: parsed.estado_agenda || "",
      trainsBot: false,
      recordedAt: args.recordedAt || undefined,
      summary: skipped.note,
      filingStatus: "skipped",
      filingJson: parsed as unknown as Prisma.InputJsonValue,
      confirmedAt: new Date(),
      estadoAgenda: parsed.estado_agenda || "",
    },
  });
  return {
    ...parsed,
    callRecordId: row.id,
    filingStatus: "skipped" as const,
    autoApplied: true,
    gap: null,
    summary: skipped.note,
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
  await recordExtractorFeedback(prisma, {
    userId,
    callRecordId: row.id,
    campo: "estado_agenda",
    valorExtraido: row.estadoAgenda || "DUDA",
    valorCorregido: "NO_COMERCIAL",
    title: row.title,
  });
  return prisma.callRecord.update({
    where: { id: row.id },
    data: {
      filingStatus: "skipped",
      confirmedAt: new Date(),
      estadoAgenda: "NO_COMERCIAL",
      callType: "NO_COMERCIAL",
      trainsBot: false,
    },
  });
}

const SALES_ESTADOS = new Set([
  "SHOW",
  "CIERRE VENTA",
  "ACUERDO SIN PAGO",
  "NO SHOW",
  "REPROGRAMA",
  "AGENDADO",
]);

export async function reviewPendingCall(
  prisma: PrismaClient,
  userId: string,
  args: {
    callRecordId: string;
    action: "commercial" | "non_commercial" | "answer";
    field?: string;
    value?: string;
  },
) {
  if (args.action === "non_commercial") {
    await skipCallFiling(prisma, userId, args.callRecordId);
    return { applied: false as const, done: true as const, gap: null };
  }
  if (args.action === "answer") {
    return confirmExtractorFiling(prisma, userId, args.callRecordId, {
      field: args.field,
      value: args.value,
    });
  }
  const row = await prisma.callRecord.findFirst({
    where: { id: args.callRecordId, userId },
  });
  if (!row) return null;
  const parsed = isExtractorJson(row.filingJson)
    ? parseExtractorJson(row.filingJson)
    : emptyExtractor();
  const before = parsed.estado_agenda || "DUDA";
  const low = parsed.confianza.estado_agenda < 85;
  if (!SALES_ESTADOS.has(parsed.estado_agenda || "")) parsed.estado_agenda = "SHOW";
  parsed.confianza.estado_agenda = 95;
  parsed.requiere_revision_humana = false;
  await recordExtractorFeedback(prisma, {
    userId,
    callRecordId: row.id,
    campo: "estado_agenda",
    valorExtraido: low ? `DUDA:${before}` : before,
    valorCorregido: parsed.estado_agenda || "SHOW",
    title: row.title,
  });
  const offers = await loadOffersForCrm(prisma, userId);
  const readyCrm = userHasReadyCrm(offers);
  const gap = extractorGap(parsed, readyCrm);
  await prisma.callRecord.update({
    where: { id: row.id },
    data: {
      filingJson: parsed as unknown as Prisma.InputJsonValue,
      estadoAgenda: parsed.estado_agenda || "",
      callType: parsed.estado_agenda || "",
      summary: gap?.question || extractorOneLiner(parsed),
      filingStatus: gap ? "pending" : "confirmed",
      confirmedAt: gap ? null : new Date(),
    },
  });
  if (!gap) {
    await applyExtractorToCrm(prisma, userId, row.id, parsed, offers);
  }
  return { applied: !gap, done: !gap, gap, parsed };
}

export async function archiveSilentNonSalesPendings(
  prisma: PrismaClient,
  userId: string,
) {
  const rows = await prisma.callRecord.findMany({
    where: { userId, filingStatus: "pending" },
    take: 40,
  });
  let archived = 0;
  for (const row of rows) {
    const parsed = isExtractorJson(row.filingJson)
      ? parseExtractorJson(row.filingJson)
      : null;
    const nonSales =
      isNonSalesCall(row.estadoAgenda) ||
      isNonSalesCall(parsed?.estado_agenda) ||
      isInternalMeetingTitle(row.title);
    if (!nonSales) continue;
    await prisma.callRecord.update({
      where: { id: row.id },
      data: {
        filingStatus: "skipped",
        confirmedAt: new Date(),
        estadoAgenda:
          parsed?.estado_agenda || row.estadoAgenda || "NO_COMERCIAL",
      },
    });
    archived += 1;
  }
  return archived;
}

export async function listPendingFilings(prisma: PrismaClient, userId: string) {
  const offers = await loadOffersForCrm(prisma, userId);
  const readyCrm = userHasReadyCrm(offers);
  await archiveSilentNonSalesPendings(prisma, userId);
  const rows = await prisma.callRecord.findMany({
    where: { userId, filingStatus: "pending" },
    orderBy: { createdAt: "desc" },
    take: 16,
  });
  return rows
    .filter((row) => {
      if (isNonSalesCall(row.estadoAgenda) || isInternalMeetingTitle(row.title)) {
        return false;
      }
      if (isExtractorJson(row.filingJson)) {
        const parsed = parseExtractorJson(row.filingJson);
        if (isNonSalesCall(parsed.estado_agenda)) return false;
      }
      return true;
    })
    .slice(0, 8)
    .map((row) => {
    if (isExtractorJson(row.filingJson)) {
      const parsed = enrichExtractorFollowup(parseExtractorJson(row.filingJson), {
        callAt: row.recordedAt,
      });
      const gap = extractorGap(parsed, readyCrm);
      return {
        id: row.id,
        title: row.title,
        source: row.source,
        sourceId: row.sourceId,
        question: gap?.question || row.summary,
        field: gap?.field || "",
        showToggle: parsed.confianza.estado_agenda < 85,
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
      showToggle: true,
      line: filing.summary,
      lines: filingSummaryLines(filing),
      filing,
    };
  });
}
