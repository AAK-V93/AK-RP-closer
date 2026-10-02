import { NextResponse } from "next/server";
import { requireFathomUser } from "@/lib/fathom-auth";
import { visibleCallTitle } from "@/lib/crm-noise";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;
    const { id } = await params;

    const row = await prisma.fathomRecording.findFirst({
      where: { id, userId },
      select: {
        id: true,
        title: true,
        shareUrl: true,
        recordedAt: true,
        transcriptText: true,
      },
    });

    if (!row) {
      return NextResponse.json({ error: "Llamada no encontrada" }, { status: 404 });
    }

    if (!row.transcriptText.trim()) {
      return NextResponse.json(
        { error: "Esta llamada aún no tiene transcripción importada" },
        { status: 409 },
      );
    }

    const tag = await prisma.callRecord.findFirst({
      where: { userId, source: "fathom", sourceId: row.id },
      select: { leadName: true },
    });

    return NextResponse.json({
      id: row.id,
      title: visibleCallTitle({
        title: row.title,
        leadName: tag?.leadName,
        date: row.recordedAt,
      }),
      shareUrl: row.shareUrl,
      recordedAt: row.recordedAt?.toISOString() || null,
      transcript: row.transcriptText,
    });
  } catch (error) {
    console.error("fathom recording GET", error);
    return NextResponse.json(
      { error: "No se pudo cargar la transcripción" },
      { status: 500 },
    );
  }
}
