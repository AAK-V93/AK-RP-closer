import type { PrismaClient } from "@prisma/client";
import { sequenceFor, type ThreadEstado, type ThreadTipo } from "@/lib/followup-machine";

const DAY = 86_400_000;

const BASE_STEP: Record<string, { tipo: ThreadTipo; paso: number }> = {
  DECISION: { tipo: "DECISION", paso: 0 },
  RETOMAR: { tipo: "RETOMAR", paso: 0 },
  OTRO: { tipo: "RETOMAR", paso: 0 },
  REAGENDAR: { tipo: "REAGENDAR", paso: 0 },
  "SEGUNDA REUNION": { tipo: "SEGUNDA_REUNION", paso: 0 },
  ONBOARDING: { tipo: "COBRANZA", paso: 0 },
  VALIDACION: { tipo: "COBRANZA", paso: 1 },
  EXPERIENCIA: { tipo: "COBRANZA", paso: 2 },
  PRE_COBRANZA: { tipo: "COBRANZA", paso: 3 },
  "PAGO PENDIENTE": { tipo: "COBRANZA", paso: 4 },
  COBRO_VENCIDO: { tipo: "COBRANZA", paso: 5 },
  POST_COBRANZA: { tipo: "COBRANZA", paso: 4 },
};

const TOUCH_RESULTADO: Record<string, string> = {
  enviado: "enviado",
  "contestó": "contestó",
  contesto: "contestó",
  hecho: "enviado",
  pago: "contestó",
  cerro: "contestó",
  "cerró": "contestó",
  no_contesto: "no_contestó",
  "no_contestó": "no_contestó",
  perdido: "no_contestó",
  mostro: "mostró",
  "mostró": "mostró",
  no_mostro: "no_mostró",
  "no_mostró": "no_mostró",
};

export type OrphanAlert = {
  type: string;
  intentos: number;
  resultado: string;
  question: string;
  resolved: boolean;
  createdAt: Date;
  dueAt: Date;
};

export type OrphanPlan = {
  tipo: ThreadTipo;
  pasoActual: number;
  estado: ThreadEstado;
  askLost: boolean;
  touchResultado: string;
  startedAt: Date;
  pagoAt: Date | null;
  meetingAt: Date | null;
  touchAt: Date;
};

function estadoFor(alert: OrphanAlert): ThreadEstado {
  if (alert.type === "POST_COBRANZA") return "ganado";
  if (!alert.resolved) return "activo";
  const resultado = alert.resultado.toLowerCase();
  if (resultado.includes("perdid")) return "perdido";
  if (resultado === "pago" || resultado === "cerro" || resultado === "cerró") return "ganado";
  if (resultado === "no_mostro" || resultado === "no_mostró") return "cerrado";
  return "cerrado";
}

/** Maps one loose alert onto a thread. Unknown types (agenda check, commission) stay loose. */
export function planOrphanAlert(alert: OrphanAlert): OrphanPlan | null {
  const base = BASE_STEP[alert.type];
  if (!base) return null;
  const steps = sequenceFor(base.tipo).steps;
  const pasoActual = Math.min(base.paso + Math.max(0, alert.intentos), steps.length - 1);
  const step = steps[pasoActual];
  const estado = estadoFor(alert);
  const askLost =
    estado === "activo" &&
    (Boolean(step.askLost) || /perdid/i.test(alert.question) || base.paso + alert.intentos >= steps.length);
  let startedAt = alert.createdAt;
  let pagoAt: Date | null = null;
  let meetingAt: Date | null = null;
  if (step.from === "start") {
    startedAt = new Date(alert.dueAt.getTime() - step.days * DAY - (step.hours || 0) * 3_600_000);
  } else if (step.from === "beforeMeeting") {
    meetingAt = new Date(alert.dueAt.getTime() + step.days * DAY);
  } else if (step.from === "beforePago") {
    pagoAt = new Date(alert.dueAt.getTime() + step.days * DAY);
  } else if (step.from === "afterPago") {
    pagoAt = new Date(alert.dueAt.getTime() - step.days * DAY);
  }
  return {
    tipo: base.tipo,
    pasoActual,
    estado,
    askLost,
    touchResultado: TOUCH_RESULTADO[alert.resultado] || TOUCH_RESULTADO[alert.resultado.toLowerCase()] || "enviado",
    startedAt,
    pagoAt,
    meetingAt,
    touchAt: alert.createdAt,
  };
}

export type BackfillResult = {
  linked: number;
  skipped: number;
  closed: number;
};

/**
 * One shot. Only rows with threadId null are touched, so a second call does nothing.
 * Not called from ensureCrmTables or any request path.
 */
export async function backfillFollowupThreads(prisma: PrismaClient): Promise<BackfillResult> {
  const alerts = await prisma.leadAlert.findMany({
    where: { threadId: null },
    include: { lead: { select: { offerName: true } } },
  });
  if (alerts.length === 0) return { linked: 0, skipped: 0, closed: 0 };
  const userIds = [...new Set(alerts.map((row) => row.userId))];
  const offers = await prisma.userOffer.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, userId: true, productName: true },
  });
  let linked = 0;
  let skipped = 0;
  let closed = 0;
  for (const alert of alerts) {
    const plan = planOrphanAlert({
      type: alert.type,
      intentos: alert.intentos,
      resultado: alert.resultado,
      question: alert.question,
      resolved: alert.resolvedAt != null,
      createdAt: alert.createdAt,
      dueAt: alert.dueAt,
    });
    if (!plan) {
      skipped += 1;
      continue;
    }
    const offer = offers.find(
      (row) =>
        row.userId === alert.userId &&
        row.productName.trim().toLowerCase() === (alert.lead.offerName || "").trim().toLowerCase(),
    );
    const thread = await prisma.followupThread.create({
      data: {
        userId: alert.userId,
        leadId: alert.leadId,
        offerId: offer?.id || "",
        tipo: plan.tipo,
        secuenciaKey: plan.tipo,
        pasoActual: plan.pasoActual,
        estado: plan.estado,
        askLost: plan.askLost,
        startedAt: plan.startedAt,
        pagoAt: plan.pagoAt,
        meetingAt: plan.meetingAt,
        creadoDesdeCallRecordId: alert.callRecordId || "",
      },
    });
    await prisma.followupTouch.create({
      data: {
        threadId: thread.id,
        fecha: plan.touchAt,
        canal: alert.canal || "WHATSAPP",
        guionUsado: alert.mensajeSugerido || "",
        libraryScriptId: alert.libraryScriptId || "",
        resultado: plan.touchResultado,
      },
    });
    const close = plan.estado !== "activo" && plan.estado !== "pausado" && alert.resolvedAt == null;
    await prisma.leadAlert.update({
      where: { id: alert.id },
      data: {
        threadId: thread.id,
        ...(close ? { resolvedAt: alert.createdAt } : {}),
      },
    });
    linked += 1;
    if (close) closed += 1;
  }
  return { linked, skipped, closed };
}
