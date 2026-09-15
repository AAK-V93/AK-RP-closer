import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";
import { buildCoachingInsights } from "@/lib/coaching";
import { evidenceSessionFilter } from "@/lib/chat-threads";
import { isCoachThreadSection } from "@/lib/closer-coach";

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "La base de datos no está configurada" },
      { status: 503 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
  }

  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: "DB no disponible" }, { status: 503 });
  }

  try {
    const rows = await prisma.practiceSession.findMany({
      where: {
        userId: session.user.id,
        ...evidenceSessionFilter(),
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const visible = rows.filter((row) => !isCoachThreadSection(row.callSection));

    return NextResponse.json(buildCoachingInsights(visible));
  } catch (error) {
    console.error("coach insights", error);
    return NextResponse.json(
      {
        error: "No se pudieron cargar las prácticas",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
