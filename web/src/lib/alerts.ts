import type { PrismaClient } from "@prisma/client";
import { addDays, alertBucket, parseCrmPrefs } from "@/lib/crm-prefs";
import { RAZONES_NO_CIERRE } from "@/lib/crm-catalog";
import { commissionOnAmount, periodStart } from "@/lib/commission";
import { defaultCommissionRule, parseCommercial } from "@/lib/offer-commercial";
import {
  buildFollowupCopy,
  followupQuestion,
} from "@/lib/followup-scripts";
import { recordLibraryOutcome } from "@/lib/followup-library";
import { recordExtractorFeedback } from "@/lib/extractor-feedback";
import { advanceStoredThread } from "@/lib/followup-threads";
import type { ThreadAction } from "@/lib/followup-machine";
import { expectedTemperature, leadTemperature } from "@/lib/lead-temperature";

export async function resolveAlert(
  prisma: PrismaClient,
  userId: string,
  alertId: string,
) {
  const row = await prisma.leadAlert.findFirst({
    where: { id: alertId, userId, resolvedAt: null },
  });
  if (!row) return null;
  await recordLibraryOutcome(prisma, row.libraryScriptId, "hecho");
  return prisma.leadAlert.update({
    where: { id: row.id },
    data: { resolvedAt: new Date(), resultado: "hecho" },
  });
}

export async function snoozeAlert(
  prisma: PrismaClient,
  userId: string,
  alertId: string,
  days = 1,
) {
  const row = await prisma.leadAlert.findFirst({
    where: { id: alertId, userId, resolvedAt: null },
  });
  if (!row) return null;
  const due = new Date(Math.max(Date.now(), row.dueAt.getTime()));
  due.setDate(due.getDate() + Math.max(1, days));
  return prisma.leadAlert.update({
    where: { id: row.id },
    data: { dueAt: due, resultado: "reprogramado", notifiedAt: null },
  });
}

export async function resolveOpenAlertsForLead(
  prisma: PrismaClient,
  userId: string,
  leadId: string,
) {
  await prisma.leadAlert.updateMany({
    where: { userId, leadId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

export type AlertOutcome =
  | "hecho"
  | "no_contesto"
  | "reprogramado"
  | "cerro"
  | "perdido"
  | "mostro"
  | "no_mostro"
  | "pago";

export async function applyAlertOutcome(
  prisma: PrismaClient,
  userId: string,
  alertId: string,
  args: {
    resultado: AlertOutcome;
    nota?: string;
    amount?: number;
    nextAt?: string;
    razonNoCierre?: string;
  },
) {
  const row = await prisma.leadAlert.findFirst({
    where: { id: alertId, userId, resolvedAt: null },
    include: { lead: true },
  });
  if (!row) return { error: "Alerta no encontrada" as const };

  const prefs = parseCrmPrefs(
    (await prisma.user.findUnique({ where: { id: userId }, select: { crmPrefs: true } }))
      ?.crmPrefs,
  );
  const nota = String(args.nota || "").trim();
  const now = new Date();

  const offer = row.lead.offerName
    ? await prisma.userOffer.findFirst({
        where: { userId, productName: row.lead.offerName },
      })
    : await prisma.userOffer.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" } });
  const commercial = parseCommercial(offer?.commercial);
  const copyFor = (type: string, intentos: number) =>
    buildFollowupCopy({
      type,
      intentos,
      vars: {
        nombre: row.lead.name,
        programa: row.lead.offerName || offer?.productName || "",
        monto: row.enJuego ? String(Math.round(row.enJuego)) : "",
        saldo: row.enJuego ? String(Math.round(row.enJuego)) : "",
        fecha: row.dueAt.toISOString().slice(0, 10),
        pago: commercial.paymentDetails,
        objecion: row.lead.razonNoCierre || row.lead.objections || "",
        deseo: "",
        closer: "",
      },
      custom: commercial.scripts,
    });

  await prisma.leadAlert.update({
    where: { id: row.id },
    data: {
      resolvedAt: now,
      resultado: args.resultado,
      resultadoNota: nota,
    },
  });
  await recordLibraryOutcome(prisma, row.libraryScriptId, args.resultado);
  const expected = expectedTemperature(args.resultado);
  if (expected) {
    const { days } = alertBucket(row.dueAt, now);
    const predicted = leadTemperature({
      enJuego: row.enJuego || 0,
      silenceDays: days < 0 ? -days : 0,
      calificado: row.lead.calificado,
      objectionOpen: Boolean((row.lead.razonNoCierre || row.lead.objections || "").trim()),
      decisionDate: row.type === "DECISION" || row.type === "PAGO PENDIENTE",
      intentos: row.intentos,
    }).level;
    await recordExtractorFeedback(prisma, {
      userId,
      callRecordId: row.callRecordId || row.id,
      campo: "temperatura",
      valorExtraido: predicted,
      valorCorregido: expected,
      title: row.lead.name,
      force: true,
    });
  }

  const threadActions = new Set<ThreadAction>([
    "hecho",
    "no_contesto",
    "cerro",
    "mostro",
    "no_mostro",
    "perdido",
    "pago",
    "reprogramado",
  ]);
  if (row.threadId && threadActions.has(args.resultado as ThreadAction)) {
    const moved = await advanceStoredThread(
      prisma,
      userId,
      row,
      row.lead,
      args.resultado as ThreadAction,
      now,
      { paymentDetails: commercial.paymentDetails, customScripts: commercial.scripts, nota },
    );
    if (moved) return { ok: true as const, followUp: moved.followUp };
  }

  if (args.resultado === "hecho") {
    if (row.type === "PAGO PENDIENTE" || row.type === "COBRO_VENCIDO") {
      await prisma.leadAlert.updateMany({
        where: {
          userId,
          leadId: row.leadId,
          type: { in: ["COBRO_VENCIDO", "PRE_COBRANZA"] },
          resolvedAt: null,
        },
        data: { resolvedAt: now },
      });
      const copy = copyFor("POST_COBRANZA", 0);
      const next = await prisma.leadAlert.create({
        data: {
          userId,
          leadId: row.leadId,
          type: "POST_COBRANZA",
          question: followupQuestion("POST_COBRANZA", row.lead.name, row.enJuego),
          dueAt: now,
          enJuego: 0,
          canal: copy.canal === "LLAMADA" ? "LLAMADA" : "WHATSAPP",
          mensajeSugerido: copy.mensaje,
          contexto: copy.recomendacion,
          libraryScriptId: copy.originId,
        },
      });
      return { ok: true as const, followUp: next };
    }
    return { ok: true as const, followUp: null };
  }

  if (args.resultado === "no_contesto") {
    const intentos = row.intentos + 1;
    const nextType =
      (row.type === "PAGO PENDIENTE" || row.type === "COBRO_VENCIDO") && intentos >= 2
        ? "COBRO_VENCIDO"
        : row.type;
    const copy = copyFor(nextType, intentos);
    if (intentos >= 3) {
      const next = await prisma.leadAlert.create({
        data: {
          userId,
          leadId: row.leadId,
          type: nextType,
          question: `Tercer intento con ${row.lead.name}. ¿Lo marco perdido?`,
          dueAt: addDays(now, 1),
          enJuego: row.enJuego,
          canal: copy.canal === "LLAMADA" ? "LLAMADA" : row.canal,
          mensajeSugerido: copy.mensaje,
          contexto: copy.recomendacion || row.contexto,
          intentos,
          libraryScriptId: copy.originId,
        },
      });
      return { ok: true as const, followUp: next, askLost: true as const };
    }
    const next = await prisma.leadAlert.create({
      data: {
        userId,
        leadId: row.leadId,
        type: nextType,
        question: followupQuestion(nextType, row.lead.name, row.enJuego),
        dueAt: addDays(now, 1),
        enJuego: row.enJuego,
        canal: copy.canal === "LLAMADA" ? "LLAMADA" : row.canal,
        mensajeSugerido: copy.mensaje,
        contexto: copy.recomendacion || row.contexto,
        intentos,
        libraryScriptId: copy.originId,
      },
    });
    return { ok: true as const, followUp: next };
  }

  if (args.resultado === "reprogramado") {
    const due = args.nextAt ? new Date(args.nextAt) : addDays(now, 1);
    const next = await prisma.leadAlert.create({
      data: {
        userId,
        leadId: row.leadId,
        type: row.type,
        question: row.question,
        dueAt: Number.isNaN(due.getTime()) ? addDays(now, 1) : due,
        enJuego: row.enJuego,
        canal: row.canal,
        mensajeSugerido: row.mensajeSugerido,
        contexto: row.contexto,
        intentos: row.intentos,
        libraryScriptId: row.libraryScriptId,
      },
    });
    return { ok: true as const, followUp: next };
  }

  if (args.resultado === "cerro") {
    const amount = args.amount || 0;
    await prisma.lead.update({
      where: { id: row.leadId },
      data: {
        status: "cerrado",
        amountPaid: amount ? String(amount) : row.lead.amountPaid,
      },
    });
    if (row.callRecordId) {
      await prisma.callRecord.updateMany({
        where: { id: row.callRecordId, userId },
        data: { estadoAgenda: "CIERRE VENTA", callType: "CIERRE VENTA", result: "cerro" },
      });
    }
    if (amount > 0) {
      const rule = commercial.commission || defaultCommissionRule();
      const from = periodStart(rule.periodoAcumulacion, now);
      const prev = await prisma.commission.aggregate({
        where: { userId, fecha: { gte: from, lt: now } },
        _sum: { cash: true },
      });
      const { pct, generada } = commissionOnAmount({
        rule,
        accumulatedBefore: prev._sum.cash || 0,
        amount,
      });
      await prisma.commission.create({
        data: {
          userId,
          leadId: row.leadId,
          callRecordId: row.callRecordId || `alert-${row.id}`,
          fecha: now,
          oferta: row.lead.offerName,
          venta: amount,
          cash: amount,
          pctAplicado: pct,
          generada,
          estado: "PENDIENTE",
        },
      });
    }
    const saldo = Math.max(0, (row.enJuego || 0) - amount);
    if (saldo > 0) {
      const next = await prisma.leadAlert.create({
        data: {
          userId,
          leadId: row.leadId,
          type: "PAGO PENDIENTE",
          question: `Queda saldo USD ${saldo} de ${row.lead.name}. ¿Lo cobraste?`,
          dueAt: addDays(now, prefs.followupGraceDays),
          enJuego: saldo,
          canal: "WHATSAPP",
          mensajeSugerido: row.mensajeSugerido,
          contexto: row.contexto,
          libraryScriptId: row.libraryScriptId,
        },
      });
      return { ok: true as const, followUp: next };
    }
    return { ok: true as const, followUp: null };
  }

  const razon = args.razonNoCierre || nota || RAZONES_NO_CIERRE[6];
  await prisma.lead.update({
    where: { id: row.leadId },
    data: { status: "perdido", razonNoCierre: razon },
  });
  await resolveOpenAlertsForLead(prisma, userId, row.leadId);
  return { ok: true as const, followUp: null, lost: true as const };
}

