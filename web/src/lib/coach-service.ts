import type { PrismaClient } from "@prisma/client";
import { generateGeminiJson } from "@/lib/gemini";
import { CLOSER_COACH_SYSTEM_PROMPT } from "@/lib/closer-coach-prompt";
import {
  compactTrainingEvidence,
  mergeCoachNotes,
  type CoachNotes,
} from "@/lib/closer-coach";
import {
  THREAD_COACH,
  appendThreadLines,
  evidenceSessionFilter,
  loadThread,
  saveCoachNotes,
} from "@/lib/chat-threads";

function parseModelJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```$/u, "")
    .trim();
  return JSON.parse(cleaned);
}

export async function getCoachThread(prisma: PrismaClient, userId: string) {
  const loaded = await loadThread(prisma, userId, THREAD_COACH);
  return {
    level: loaded.notes.level,
    niche: loaded.notes.niche,
    notes: loaded.notes,
    messages: loaded.messages,
  };
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
  const loaded = await loadThread(prisma, userId, THREAD_COACH);
  const limit = args.evidenceLimit ?? 16;
  const sessions = await prisma.practiceSession.findMany({
    where: { userId, ...evidenceSessionFilter() },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const notes = loaded.notes;
  const evidence = compactTrainingEvidence(sessions, limit);
  const history = loaded.messages.slice(-16).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 2500),
  }));

  const prompt = `${CLOSER_COACH_SYSTEM_PROMPT}

# NOTAS PERSISTENTES DEL COACH
${JSON.stringify(notes)}

# EVIDENCIA OBSERVADA (prácticas por voz + QC de llamadas reales)
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
    notes?: Partial<CoachNotes>;
  };

  const reply = String(parsed.reply || "").trim();
  if (!reply) {
    throw new Error("El coach devolvió una respuesta vacía.");
  }

  const nextNotes = mergeCoachNotes(notes, parsed.notes);
  await saveCoachNotes(prisma, loaded.profile.id, nextNotes);

  const incoming: { role: "user" | "coach"; content: string }[] = [];
  if (args.userMessage?.trim()) {
    incoming.push({ role: "user", content: args.userMessage.trim() });
  }
  incoming.push({ role: "coach", content: reply });
  const created = await appendThreadLines(
    prisma,
    loaded.profile.id,
    THREAD_COACH,
    incoming,
  );
  const coachLine = created[created.length - 1];
  const messages = [...loaded.messages, ...created];

  return {
    level: nextNotes.level,
    niche: nextNotes.niche,
    notes: nextNotes,
    message: coachLine,
    messages,
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
   - drills concretos (texto aquí o mandarme al agente de voz de práctica con sección, dificultad y foco)
   - métrica de éxito: qué debería verse distinto en la próxima llamada real

No me des teoría genérica. Prioriza desempeño observado. Si hay huecos de discovery que alimentan objeciones de dinero, conéctalos explícitamente.

Termina con el siguiente drill que debo hacer HOY.`;
