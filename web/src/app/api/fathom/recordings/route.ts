import { NextResponse } from "next/server";
import { requireFathomUser } from "@/lib/fathom-auth";

export async function GET() {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    const rows = await prisma.fathomRecording.findMany({
      where: { userId },
      orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        fathomRecordingId: true,
        title: true,
        shareUrl: true,
        recordedAt: true,
        syncedAt: true,
        transcriptText: true,
        practiceSessionId: true,
      },
    });

    return NextResponse.json({
      recordings: rows.map((row) => ({
        id: row.id,
        fathomRecordingId: row.fathomRecordingId,
        title: row.title,
        shareUrl: row.shareUrl,
        recordedAt: row.recordedAt?.toISOString() || null,
        syncedAt: row.syncedAt.toISOString(),
        hasTranscript:
          row.transcriptText.trim().length > 0 &&
          row.transcriptText !== "[sin transcripción]",
        analyzed:
          Boolean(row.practiceSessionId) && row.practiceSessionId !== "skipped",
        skipped: row.practiceSessionId === "skipped",
        practiceSessionId:
          row.practiceSessionId === "skipped" ? null : row.practiceSessionId,
      })),
    });
  } catch (error) {
    console.error("fathom recordings GET", error);
    return NextResponse.json(
      { error: "No se pudieron cargar las llamadas de Fathom" },
      { status: 500 },
    );
  }
}
