import type { PrismaClient } from "@prisma/client";
import { buildFollowupCopy, followupQuestion, type FollowupScript } from "@/lib/followup-scripts";
import {
  advanceThread,
  lastTouchText,
  nextActionText,
  pasoLabel,
  pickThreadKind,
  sequenceFor,
  stepAt,
  stepDue,
  type ExtractorSituation,
  type ThreadAction,
  type ThreadAnchors,
  type ThreadTipo,
} from "@/lib/followup-machine";

function anchorsOf(thread: {
  startedAt: Date;
  pagoAt: Date | null;
  meetingAt: Date | null;
}): ThreadAnchors {
  return { start: thread.startedAt, pagoAt: thread.pagoAt, meetingAt: thread.meetingAt };
}

async function projectThreadAlert(
  prisma: PrismaClient,
  args: {
    thread: {
      id: string;
      userId: string;
      leadId: string;
      tipo: string;
      pasoActual: number;
      askLost: boolean;
      startedAt: Date;
      pagoAt: Date | null;
      meetingAt: Date | null;
      creadoDesdeCallRecordId: string;
    };
    leadName: string;
    offerName: string;
    enJuego: number;
    paymentDetails: string;
    customScripts: FollowupScript[];
    objecion: string;
    now: Date;
    dueAt: Date | null;
  },
) {
  await prisma.leadAlert.updateMany({
    where: { threadId: args.thread.id, resolvedAt: null },
    data: { resolvedAt: args.now },
  });
  if (!args.dueAt) return null;
  const tipo = args.thread.tipo as ThreadTipo;
  const step = stepAt(tipo, args.thread.pasoActual);
  const copy = buildFollowupCopy({
    type: step.scriptType,
    intentos: args.thread.pasoActual,
    vars: {
      nombre: args.leadName,
      programa: args.offerName,
      monto: args.enJuego ? String(Math.round(args.enJuego)) : "",
      saldo: args.enJuego ? String(Math.round(args.enJuego)) : "",
      fecha: args.dueAt.toISOString().slice(0, 10),
      pago: args.paymentDetails,
      objecion: args.objecion,
      deseo: "",
      closer: "",
    },
    custom: args.customScripts,
  });
  const accion = nextActionText(step.accion, args.dueAt, args.now, args.thread.askLost);
  return prisma.leadAlert.create({
    data: {
      userId: args.thread.userId,
      leadId: args.thread.leadId,
      threadId: args.thread.id,
      type: step.scriptType,
      question: args.thread.askLost
        ? `¿Marco a ${args.leadName} como perdido?`
        : followupQuestion(step.scriptType, args.leadName, args.enJuego),
      dueAt: args.dueAt,
      enJuego: args.enJuego,
      canal: step.canal === "LLAMADA" ? "LLAMADA" : "WHATSAPP",
      mensajeSugerido: copy.mensaje,
      contexto: accion,
      callRecordId: args.thread.creadoDesdeCallRecordId,
      intentos: args.thread.pasoActual,
      libraryScriptId: copy.originId || "",
    },
  });
}

export async function openFollowupThread(
  prisma: PrismaClient,
  args: {
    userId: string;
    leadId: string;
    leadName: string;
    offerId: string;
    offerName: string;
    parsed: ExtractorSituation;
    callAt: Date;
    callRecordId: string;
    pagoAt: Date | null;
    meetingAt: Date | null;
    enJuego: number;
    paymentDetails: string;
    customScripts?: FollowupScript[];
    objecion?: string;
  },
) {
  const tipo = pickThreadKind(args.parsed);
  if (!tipo) return null;
  const existing = await prisma.followupThread.findFirst({
    where: { userId: args.userId, leadId: args.leadId, tipo, estado: "activo" },
  });
  if (existing) return existing;
  const anchors: ThreadAnchors = {
    start: args.callAt,
    pagoAt: args.pagoAt,
    meetingAt: args.meetingAt,
  };
  const dueAt = stepDue(stepAt(tipo, 0), anchors, args.callAt);
  const thread = await prisma.followupThread.create({
    data: {
      userId: args.userId,
      leadId: args.leadId,
      offerId: args.offerId,
      tipo,
      secuenciaKey: tipo,
      pasoActual: 0,
      estado: "activo",
      askLost: Boolean(stepAt(tipo, 0).askLost),
      startedAt: args.callAt,
      pagoAt: args.pagoAt,
      meetingAt: args.meetingAt,
      creadoDesdeCallRecordId: args.callRecordId,
    },
  });
  await projectThreadAlert(prisma, {
    thread,
    leadName: args.leadName,
    offerName: args.offerName,
    enJuego: args.enJuego,
    paymentDetails: args.paymentDetails,
    customScripts: args.customScripts || [],
    objecion: args.objecion || "",
    now: args.callAt,
    dueAt,
  });
  return thread;
}

export async function advanceStoredThread(
  prisma: PrismaClient,
  userId: string,
  alert: {
    id: string;
    threadId: string | null;
    leadId: string;
    enJuego: number;
    callRecordId: string | null;
    libraryScriptId: string;
    mensajeSugerido: string;
    canal: string;
  },
  lead: { name: string; offerName: string; razonNoCierre: string; objections: string },
  action: ThreadAction,
  now: Date,
  extras: { paymentDetails: string; customScripts: FollowupScript[]; nota?: string },
) {
  if (!alert.threadId) return null;
  const thread = await prisma.followupThread.findFirst({
    where: { id: alert.threadId, userId },
  });
  if (!thread || thread.estado !== "activo") return null;
  const tipo = thread.tipo as ThreadTipo;
  const moved = advanceThread({
    tipo,
    pasoActual: thread.pasoActual,
    action,
    anchors: anchorsOf(thread),
    now,
    hasSaldo: alert.enJuego > 0,
  });
  await prisma.followupTouch.create({
    data: {
      threadId: thread.id,
      fecha: now,
      canal: alert.canal || "WHATSAPP",
      guionUsado: alert.mensajeSugerido || "",
      libraryScriptId: alert.libraryScriptId || "",
      resultado: moved.touchResultado,
      notas: extras.nota || "",
    },
  });
  await prisma.followupThread.update({
    where: { id: thread.id },
    data: {
      estado: moved.estado,
      pasoActual: moved.pasoActual,
      askLost: moved.askLost,
    },
  });
  await prisma.leadAlert.update({
    where: { id: alert.id },
    data: { resolvedAt: now, resultado: action, resultadoNota: extras.nota || "" },
  });
  if (action === "perdido") {
    await prisma.lead.update({
      where: { id: thread.leadId },
      data: { razonNoCierre: extras.nota || lead.razonNoCierre || "perdido", status: "perdido" },
    });
  }
  let spawned: { id: string } | null = null;
  if (moved.spawn) {
    const spawnTipo = moved.spawn;
    const dueAt = stepDue(stepAt(spawnTipo, 0), anchorsOf(thread), now);
    spawned = await prisma.followupThread.create({
      data: {
        userId,
        leadId: thread.leadId,
        offerId: thread.offerId,
        tipo: spawnTipo,
        secuenciaKey: spawnTipo,
        pasoActual: 0,
        estado: "activo",
        startedAt: now,
        pagoAt: thread.pagoAt,
        meetingAt: null,
        creadoDesdeCallRecordId: thread.creadoDesdeCallRecordId,
      },
    });
    await projectThreadAlert(prisma, {
      thread: { ...spawned, tipo: spawnTipo, pasoActual: 0, askLost: false, startedAt: now, pagoAt: thread.pagoAt, meetingAt: null, creadoDesdeCallRecordId: thread.creadoDesdeCallRecordId, userId, leadId: thread.leadId },
      leadName: lead.name,
      offerName: lead.offerName,
      enJuego: alert.enJuego,
      paymentDetails: extras.paymentDetails,
      customScripts: extras.customScripts,
      objecion: lead.razonNoCierre || lead.objections || "",
      now,
      dueAt,
    });
  }
  if (moved.estado === "activo" && moved.dueAt) {
    const fresh = { ...thread, pasoActual: moved.pasoActual, askLost: moved.askLost };
    await projectThreadAlert(prisma, {
      thread: fresh,
      leadName: lead.name,
      offerName: lead.offerName,
      enJuego: alert.enJuego,
      paymentDetails: extras.paymentDetails,
      customScripts: extras.customScripts,
      objecion: lead.razonNoCierre || lead.objections || "",
      now,
      dueAt: moved.dueAt,
    });
  }
  return { ok: true as const, followUp: spawned, moved };
}

export function presentThread(args: {
  tipo: string;
  pasoActual: number;
  askLost: boolean;
  startedAt: Date;
  pagoAt: Date | null;
  meetingAt: Date | null;
  enJuego: number;
  lastTouch: { fecha: Date; resultado: string } | null;
  now: Date;
}) {
  const tipo = args.tipo as ThreadTipo;
  const sequence = sequenceFor(tipo);
  const step = stepAt(tipo, args.pasoActual);
  const due = stepDue(step, anchorsOf(args), args.now);
  return {
    hilo: tipo,
    paso: pasoLabel(args.pasoActual, sequence.steps.length),
    ultimoToque: lastTouchText(args.lastTouch?.fecha || null, args.lastTouch?.resultado || "", args.now),
    proximaAccion: nextActionText(step.accion, due, args.now, args.askLost),
    scriptType: step.scriptType,
    canal: step.canal,
    askLost: args.askLost,
    dueAt: due.toISOString(),
  };
}

export type ThreadPresent = ReturnType<typeof presentThread>;
