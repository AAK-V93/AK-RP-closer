import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { ensureCrmTables, ensureFathomTables } from "@/lib/prisma";
import { EMPTY_TRANSCRIPT_MARK, isUsableTranscript } from "@/lib/fathom-import";
import { fileCallQuietly } from "@/lib/file-call";

export async function GET() {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    try {
      await ensureFathomTables(auth.prisma);
    } catch {
      /* optional */
    }

    const [fathom, uploads, tags] = await Promise.all([
      auth.prisma.fathomRecording.findMany({
        where: { userId: auth.userId },
        orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
        take: 80,
        select: {
          id: true,
          title: true,
          recordedAt: true,
          transcriptText: true,
          practiceSessionId: true,
        },
      }),
      auth.prisma.clientTranscript.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: "desc" },
        take: 80,
      }),
      auth.prisma.callRecord.findMany({
        where: { userId: auth.userId },
      }),
    ]);

    const tagKey = (source: string, id: string) => `${source}:${id}`;
    const tagMap = new Map(
      tags.map((row) => [tagKey(row.source, row.sourceId), row]),
    );

    const calls = [
      ...fathom
        .filter((row) => row.transcriptText !== EMPTY_TRANSCRIPT_MARK)
        .map((row) => {
          const tag = tagMap.get(tagKey("fathom", row.id));
          return {
            id: row.id,
            source: "fathom" as const,
            title: tag?.title || row.title,
            date: row.recordedAt?.toISOString() || null,
            callType: tag?.callType || "",
            result: tag?.result || "",
            leadName: tag?.leadName || "",
            offerName: tag?.offerName || "",
            trainsBot: tag?.trainsBot || false,
            analyzed: Boolean(
              (row.practiceSessionId && row.practiceSessionId !== "skipped") ||
                tag?.practiceSessionId,
            ),
            href:
              row.practiceSessionId && row.practiceSessionId !== "skipped"
                ? `/coach/${row.practiceSessionId}`
                : tag?.practiceSessionId
                  ? `/coach/${tag.practiceSessionId}`
                  : "/llamadas",
          };
        }),
      ...uploads.map((row) => {
        const tag = tagMap.get(tagKey("upload", row.id));
        return {
          id: row.id,
          source: "upload" as const,
          title: tag?.title || row.title,
          date: row.createdAt.toISOString(),
          callType: tag?.callType || "",
          result: tag?.result || "",
          leadName: tag?.leadName || "",
          offerName: tag?.offerName || "",
          trainsBot: tag?.trainsBot || false,
            analyzed: Boolean(tag?.practiceSessionId),
            href: tag?.practiceSessionId
              ? `/coach/${tag.practiceSessionId}`
              : "/llamadas",
        };
      }),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

    return NextResponse.json({ calls });
  } catch (error) {
    console.error("llamadas GET", error);
    return NextResponse.json({ error: "No se pudieron cargar las llamadas" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    try {
      await ensureFathomTables(auth.prisma);
    } catch {
      /* optional */
    }

    const tagged = await auth.prisma.callRecord.findMany({
      where: { userId: auth.userId },
      select: { source: true, sourceId: true },
    });
    const seen = new Set(tagged.map((row) => `${row.source}:${row.sourceId}`));

    const [fathom, uploads] = await Promise.all([
      auth.prisma.fathomRecording.findMany({
        where: { userId: auth.userId },
        orderBy: { recordedAt: "desc" },
        take: 30,
        select: {
          id: true,
          title: true,
          transcriptText: true,
          recordedAt: true,
        },
      }),
      auth.prisma.clientTranscript.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          title: true,
          transcriptText: true,
          createdAt: true,
        },
      }),
    ]);

    const pendingFathom = fathom.find(
      (row) =>
        !seen.has(`fathom:${row.id}`) && isUsableTranscript(row.transcriptText),
    );
    const pendingUpload = uploads.find(
      (row) =>
        !seen.has(`upload:${row.id}`) && isUsableTranscript(row.transcriptText),
    );
    const next = pendingFathom
      ? {
          source: "fathom" as const,
          sourceId: pendingFathom.id,
          title: pendingFathom.title,
          transcript: pendingFathom.transcriptText,
          recordedAt: pendingFathom.recordedAt,
        }
      : pendingUpload
        ? {
            source: "upload" as const,
            sourceId: pendingUpload.id,
            title: pendingUpload.title,
            transcript: pendingUpload.transcriptText,
            recordedAt: pendingUpload.createdAt,
          }
        : null;

    if (!next) return NextResponse.json({ classified: 0, done: true });

    const taggedCall = await fileCallQuietly(auth.prisma, auth.userId, next);
    return NextResponse.json({
      classified: taggedCall ? 1 : 0,
      done: !taggedCall,
      call: taggedCall,
    });
  } catch (error) {
    console.error("llamadas POST", error);
    return NextResponse.json({ error: "No se pudo clasificar" }, { status: 500 });
  }
}
