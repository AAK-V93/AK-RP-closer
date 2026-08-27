import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";
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

export const runtime = "nodejs";
export const maxDuration = 60;

function parseModelJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```$/u, "")
    .trim();
  return JSON.parse(cleaned);
}

function fail(error: unknown, fallback: string, status = 500) {
  console.error("coach-chat", error);
  return NextResponse.json(
    {
      error: fallback,
      details: error instanceof Error ? error.message : String(error),
    },
    { status },
  );
}

function threadResponse(payload: CoachThreadPayload) {
  return {
    level: payload.notes.level,
    niche: payload.notes.niche,
    notes: payload.notes,
    messages: payload.messages,
  };
}

async function requireDb() {
  if (!isDatabaseConfigured()) {
    return {
      error: NextResponse.json(
        { error: "La base de datos no está configurada" },
        { status: 503 },
      ),
    };
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Inicia sesión" }, { status: 401 }),
    };
  }
  const prisma = getPrisma();
  if (!prisma) {
    return {
      error: NextResponse.json({ error: "DB no disponible" }, { status: 503 }),
    };
  }
  return { prisma, userId: session.user.id };
}

async function getOrCreateThread(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
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

async function saveThread(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
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

function newLine(role: CoachChatLine["role"], content: string): CoachChatLine {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const auth = await requireDb();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth as {
      prisma: NonNullable<ReturnType<typeof getPrisma>>;
      userId: string;
    };
    const { payload } = await getOrCreateThread(prisma, userId);
    return NextResponse.json(threadResponse(payload));
  } catch (error) {
    return fail(error, "No se pudo cargar el coach");
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireDb();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth as {
      prisma: NonNullable<ReturnType<typeof getPrisma>>;
      userId: string;
    };

    let body: { message?: string; start?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const start = Boolean(body.start);
    const userText = String(body.message || "").trim();
    if (!start && userText.length < 1) {
      return NextResponse.json({ error: "Escribe un mensaje" }, { status: 400 });
    }
    if (userText.length > 4000) {
      return NextResponse.json({ error: "Mensaje demasiado largo" }, { status: 400 });
    }

    const [{ row, payload }, sessions] = await Promise.all([
      getOrCreateThread(prisma, userId),
      prisma.practiceSession.findMany({
        where: { userId, callSection: { not: COACH_THREAD_SECTION } },
        orderBy: { createdAt: "desc" },
        take: 16,
      }),
    ]);

    if (start && payload.messages.length > 0) {
      return NextResponse.json(threadResponse(payload));
    }

    const notes = payload.notes;
    const evidence = compactTrainingEvidence(sessions);
    const history = payload.messages.slice(-16).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 2500),
    }));

    const closerTurn = start
      ? "El closer acaba de abrir el chat por primera vez. Haz el diagnóstico inicial (PRIMERA INTERACCIÓN). Si ya hay evidencia de prácticas o QC, úsala y no preguntes lo que ya sabes. La primera sesión debe incluir práctica, no solo teoría."
      : userText;

    const prompt = `${CLOSER_COACH_SYSTEM_PROMPT}

# NOTAS PERSISTENTES DEL COACH
${JSON.stringify(notes)}

# EVIDENCIA OBSERVADA (prácticas con bot + QC de llamadas reales)
${JSON.stringify(evidence)}

# HISTORIAL RECIENTE
${JSON.stringify(history)}

# MENSAJE DEL CLOSER
${closerTurn}`;

    let parsed: { reply?: string; notes?: Partial<typeof notes> };
    try {
      const text = await generateGeminiJson(prompt, 0.45, 4096);
      parsed = parseModelJson(text) as {
        reply?: string;
        notes?: Partial<typeof notes>;
      };
    } catch (error) {
      return fail(error, "El coach no pudo responder ahora. Intenta de nuevo.", 502);
    }

    const reply = String(parsed.reply || "").trim();
    if (!reply) {
      return NextResponse.json(
        { error: "El coach devolvió una respuesta vacía." },
        { status: 502 },
      );
    }

    const nextNotes = mergeCoachNotes(notes, parsed.notes);
    const coachLine = newLine("coach", reply);
    const nextMessages = [...payload.messages];
    if (!start && userText) {
      nextMessages.push(newLine("user", userText));
    }
    nextMessages.push(coachLine);

    const nextPayload: CoachThreadPayload = {
      kind: "coach_thread",
      notes: nextNotes,
      messages: nextMessages,
    };
    await saveThread(prisma, row.id, nextPayload);

    return NextResponse.json({
      ...threadResponse(nextPayload),
      message: coachLine,
    });
  } catch (error) {
    return fail(error, "No se pudo responder el coach");
  }
}
