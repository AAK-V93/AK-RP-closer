import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { generateGeminiJson } from "@/lib/gemini";
import { CLOSER_COACH_SYSTEM_PROMPT } from "@/lib/closer-coach-prompt";
import {
  COACH_THREAD_SECTION,
  compactTrainingEvidence,
  defaultCoachNotes,
  mergeCoachNotes,
  parseCoachThread,
  type CoachChatLine,
  type CoachThreadPayload,
} from "@/lib/closer-coach";

function parseModelJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```$/u, "")
    .trim();
  return JSON.parse(cleaned);
}

function newLine(role: CoachChatLine["role"], content: string): CoachChatLine {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export async function getOrCreateCoachThread(
  prisma: PrismaClient,
  userId: string,
) {
  const existing = await prisma.practiceSession.findFirst({
    where: { userId, callSection: COACH_THREAD_SECTION },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return { row: existing, payload: parseCoachThread(existing.evaluation) };
  }

  const payload: CoachThreadPayload = {
    kind: "coach_thread",
    notes: defaultCoachNotes(),
    messages: [],
  };
  const row = await prisma.practiceSession.create({
    data: {
      userId,
      callSection: COACH_THREAD_SECTION,
      productName: "Coach high-ticket",
      difficulty: "coach",
      language: "es",
      overallScore: 0,
      outcomeSummary: "",
      transcript: [],
      evaluation: payload as unknown as Prisma.InputJsonValue,
      criterionScores: [],
      scored: false,
    },
  });
  return { row, payload };
}

async function saveCoachThread(
  prisma: PrismaClient,
  rowId: string,
  payload: CoachThreadPayload,
) {
  const notes = payload.notes;
  await prisma.practiceSession.update({
    where: { id: rowId },
    data: {
      overallScore: notes.level,
      outcomeSummary: notes.nextSkill.slice(0, 280),
      evaluation: {
        ...payload,
        messages: payload.messages.slice(-80),
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function runCoachTurn(
  prisma: PrismaClient,
  userId: string,
  args: {
    closerTurn: string;
    userMessage?: string;
    evidenceLimit?: number;
  },
) {
  const [{ row, payload }, sessions] = await Promise.all([
    getOrCreateCoachThread(prisma, userId),
    prisma.practiceSession.findMany({
      where: { userId, callSection: { not: COACH_THREAD_SECTION } },
      orderBy: { createdAt: "desc" },
      take: args.evidenceLimit ?? 16,
    }),
  ]);

  const notes = payload.notes;
  const evidence = compactTrainingEvidence(sessions, args.evidenceLimit ?? 16);
  const history = payload.messages.slice(-16).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 2500),
  }));

  const prompt = `${CLOSER_COACH_SYSTEM_PROMPT}

# NOTAS PERSISTENTES DEL COACH
${JSON.stringify(notes)}

# EVIDENCIA OBSERVADA (prácticas con bot + QC de llamadas reales)
${JSON.stringify(evidence)}

# HISTORIAL RECIENTE
${JSON.stringify(history)}

# MENSAJE DEL CLOSER
${args.closerTurn}`;

  const text = await generateGeminiJson(prompt, 0.45, 4096, {
    timeoutMs: 90_000,
    models: ["gemini-flash-latest", "gemini-flash-lite-latest"],
  });
  const parsed = parseModelJson(text) as {
    reply?: string;
    notes?: Partial<typeof notes>;
  };

  const reply = String(parsed.reply || "").trim();
  if (!reply) {
    throw new Error("El coach devolvió una respuesta vacía.");
  }

  const nextNotes = mergeCoachNotes(notes, parsed.notes);
  const coachLine = newLine("coach", reply);
  const nextMessages = [...payload.messages];
  if (args.userMessage?.trim()) {
    nextMessages.push(newLine("user", args.userMessage.trim()));
  }
  nextMessages.push(coachLine);

  const nextPayload: CoachThreadPayload = {
    kind: "coach_thread",
    notes: nextNotes,
    messages: nextMessages,
  };
  await saveCoachThread(prisma, row.id, nextPayload);

  return {
    level: nextNotes.level,
    niche: nextNotes.niche,
    notes: nextNotes,
    message: coachLine,
    messages: nextPayload.messages,
  };
}

export const FATHOM_STRATEGY_PROMPT = `Acabo de importar y auditar automáticamente un lote de llamadas reales desde Fathom.

Tu trabajo ahora:
1) Revisa TODA la evidencia QC disponible (no solo la última llamada).
2) Identifica patrones recurrentes en mis debilidades, errores críticos y momentos desaprovechados.
3) Corrígeme con dureza constructiva, citando evidencia concreta de varias llamadas cuando aplique.
4) Diseña una estrategia de mejora clara y accionable:
   - nivel actual estimado (1-10) con justificación
   - top 3 debilidades que más me están costando cierres
   - errores recurrentes (los que se repiten en varias llamadas)
   - plan de entrenamiento de 2 semanas (qué practicar cada semana)
   - drills concretos (texto aquí o mandarme al bot de voz con sección, dificultad y foco)
   - métrica de éxito: qué debería verse distinto en la próxima llamada real

No me des teoría genérica. Prioriza desempeño observado. Si hay huecos de discovery que alimentan objeciones de dinero, conéctalos explícitamente.

Termina con el siguiente drill que debo hacer HOY.`;
