import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPrisma, isDatabaseConfigured, ensureCoachTables } from "@/lib/prisma";
import { getCoachThread, runCoachTurn } from "@/lib/coach-service";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  try {
    await ensureCoachTables(prisma);
  } catch {
    /* column may already exist */
  }
  return { prisma, userId: session.user.id };
}

export async function GET() {
  try {
    const auth = await requireDb();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth as {
      prisma: NonNullable<ReturnType<typeof getPrisma>>;
      userId: string;
    };
    return NextResponse.json(await getCoachThread(prisma, userId));
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

    const existing = await getCoachThread(prisma, userId);
    if (start && existing.messages.length > 0) {
      return NextResponse.json(existing);
    }

    const closerTurn = start
      ? "El closer acaba de abrir el chat por primera vez. Haz el diagnóstico inicial (PRIMERA INTERACCIÓN). Si ya hay evidencia de prácticas o QC, úsala y no preguntes lo que ya sabes. La primera sesión debe incluir práctica, no solo teoría."
      : userText;

    try {
      const result = await runCoachTurn(prisma, userId, {
        closerTurn,
        userMessage: start ? undefined : userText,
      });
      return NextResponse.json(result);
    } catch (error) {
      return fail(error, "El coach no pudo responder ahora. Intenta de nuevo.", 502);
    }
  } catch (error) {
    return fail(error, "No se pudo responder el coach");
  }
}
