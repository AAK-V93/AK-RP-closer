import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";
import { generateGeminiJson } from "@/lib/gemini";
import { CLOSER_COACH_SYSTEM_PROMPT } from "@/lib/closer-coach-prompt";
import {
  compactTrainingEvidence,
  mergeCoachNotes,
  parseStoredNotes,
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

async function requireDb(userIdNeeded = true) {
  if (!isDatabaseConfigured()) {
    return { error: NextResponse.json({ error: "La base de datos no está configurada" }, { status: 503 }) };
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id && userIdNeeded) {
    return { error: NextResponse.json({ error: "Inicia sesión" }, { status: 401 }) };
  }
  const prisma = getPrisma();
  if (!prisma) {
    return { error: NextResponse.json({ error: "DB no disponible" }, { status: 503 }) };
  }
  return { prisma, userId: session?.user?.id as string };
}

export async function GET() {
  const auth = await requireDb();
  if ("error" in auth && auth.error) return auth.error;
  const { prisma, userId } = auth as { prisma: NonNullable<ReturnType<typeof getPrisma>>; userId: string };

  const profile = await prisma.coachProfile.upsert({
    where: { userId },
    create: { userId },
    update: {},
    include: {
      messages: { orderBy: { createdAt: "asc" as const }, take: 80 },
    },
  });

  return NextResponse.json({
    level: profile.level,
    niche: profile.niche,
    notes: parseStoredNotes(profile.notes),
    messages: profile.messages.map((m) => ({
      id: m.id,
      role: m.role as ChatMessage["role"],
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireDb();
  if ("error" in auth && auth.error) return auth.error;
  const { prisma, userId } = auth as { prisma: NonNullable<ReturnType<typeof getPrisma>>; userId: string };

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

  const [profile, sessions] = await Promise.all([
    prisma.coachProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: {
        messages: { orderBy: { createdAt: "asc" as const }, take: 40 },
      },
    }),
    prisma.practiceSession.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 16,
    }),
  ]);

  if (start && profile.messages.length > 0) {
    return NextResponse.json({
      level: profile.level,
      niche: profile.niche,
      notes: parseStoredNotes(profile.notes),
      messages: profile.messages.map((m) => ({
        id: m.id,
        role: m.role as ChatMessage["role"],
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }

  const notes = parseStoredNotes(profile.notes);
  const evidence = compactTrainingEvidence(sessions);
  const history = profile.messages.slice(-16).map((m) => ({
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
    parsed = parseModelJson(text) as { reply?: string; notes?: Partial<typeof notes> };
  } catch (error) {
    return NextResponse.json(
      {
        error: "El coach no pudo responder ahora. Intenta de nuevo.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  const reply = String(parsed.reply || "").trim();
  if (!reply) {
    return NextResponse.json(
      { error: "El coach devolvió una respuesta vacía." },
      { status: 502 },
    );
  }

  const nextNotes = mergeCoachNotes(notes, parsed.notes);

  if (!start && userText) {
    await prisma.coachMessage.create({
      data: { profileId: profile.id, role: "user", content: userText },
    });
  }

  const saved = await prisma.coachMessage.create({
    data: { profileId: profile.id, role: "coach", content: reply },
  });

  await prisma.coachProfile.update({
    where: { id: profile.id },
    data: {
      level: nextNotes.level,
      niche: nextNotes.niche,
      notes: nextNotes as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    level: nextNotes.level,
    niche: nextNotes.niche,
    notes: nextNotes,
    message: {
      id: saved.id,
      role: "coach" as const,
      content: saved.content,
      createdAt: saved.createdAt.toISOString(),
    },
  });
}
