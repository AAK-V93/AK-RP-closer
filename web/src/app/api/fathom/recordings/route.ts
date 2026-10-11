import { NextResponse } from "next/server";
import { requireFathomUser } from "@/lib/fathom-auth";
import { visibleCallTitle } from "@/lib/crm-noise";
import { EMPTY_TRANSCRIPT_MARK } from "@/lib/fathom-import";

export async function GET() {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    // Only whether there is a transcript, never the text itself (each one is ~50 KB).
    const rows = await prisma.$queryRaw<
      {
        id: string;
        fathomRecordingId: string;
        title: string;
        shareUrl: string;
        recordedAt: Date | string | null;
        syncedAt: Date | string;
        practiceSessionId: string | null;
        hasTranscript: boolean;
      }[]
    >`
      SELECT "id", "fathomRecordingId", "title", "shareUrl", "recordedAt", "syncedAt", "practiceSessionId",
        (length(btrim("transcriptText")) > 0 AND "transcriptText" <> ${EMPTY_TRANSCRIPT_MARK}) AS "hasTranscript"
      FROM "FathomRecording"
      WHERE "userId" = ${userId}
      ORDER BY "recordedAt" DESC NULLS LAST, "syncedAt" DESC
      LIMIT 200
    `;

    const tags = await prisma.callRecord.findMany({
      where: { userId, source: "fathom" },
      select: { sourceId: true, leadName: true },
    });
    const leadByRecording = new Map(tags.map((row) => [row.sourceId, row.leadName]));

    return NextResponse.json({
      recordings: rows.map((row) => ({
        id: row.id,
        fathomRecordingId: row.fathomRecordingId,
        title: visibleCallTitle({
          title: row.title,
          leadName: leadByRecording.get(row.id),
          date: row.recordedAt ? new Date(row.recordedAt) : null,
        }),
        shareUrl: row.shareUrl,
        recordedAt: row.recordedAt ? new Date(row.recordedAt).toISOString() : null,
        syncedAt: new Date(row.syncedAt).toISOString(),
        hasTranscript: Boolean(row.hasTranscript),
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
