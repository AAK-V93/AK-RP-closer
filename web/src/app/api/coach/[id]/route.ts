import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";
import { isCoachThreadSection } from "@/lib/closer-coach";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const row = await prisma.practiceSession.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!row || isCoachThreadSection(row.callSection)) {
    return NextResponse.json({ error: "Análisis no encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    productName: row.productName,
    callSection: row.callSection,
    difficulty: row.difficulty,
    language: row.language,
    overallScore: row.overallScore,
    outcomeSummary: row.outcomeSummary,
    scored: row.scored,
    transcript: row.transcript,
    evaluation: row.evaluation,
  });
}
