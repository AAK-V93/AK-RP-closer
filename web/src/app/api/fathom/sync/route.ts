import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  FathomApiError,
  getFathomTranscript,
  listFathomMeetings,
  meetingRecordedAt,
  meetingTitle,
} from "@/lib/fathom";
import {
  EMPTY_TRANSCRIPT_MARK,
  FATHOM_SKIPPED,
  isUsableTranscript,
  parseImportSince,
} from "@/lib/fathom-import";
import { fathomTranscriptToText } from "@/lib/fathom-transcript";
import {
  getFathomApiKey,
  getFathomConnection,
  requireFathomUser,
} from "@/lib/fathom-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const TRANSCRIPT_BATCH = 3;

export async function POST(request: Request) {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    const connection = await getFathomConnection(prisma, userId);
    if (!connection) {
      return NextResponse.json(
        { error: "Conecta Fathom antes de sincronizar" },
        { status: 400 },
      );
    }

    const apiKey = await getFathomApiKey(prisma, userId);
    if (!apiKey) {
      return NextResponse.json(
        { error: "No hay API key guardada para Fathom" },
        { status: 400 },
      );
    }

    let body: {
      phase?: string;
      cursor?: string | null;
      createdAfter?: string | null;
    } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const importSince =
      parseImportSince(body.createdAfter) ||
      parseImportSince(connection.importSince?.toISOString() || null);
    if (importSince && !connection.importSince) {
      await prisma.fathomConnection.update({
        where: { id: connection.id },
        data: { importSince },
      });
    } else if (
      importSince &&
      body.createdAfter &&
      connection.importSince?.toISOString() !== importSince.toISOString()
    ) {
      await prisma.fathomConnection.update({
        where: { id: connection.id },
        data: { importSince },
      });
    }

    if (importSince) {
      await prisma.fathomRecording.updateMany({
        where: {
          userId,
          recordedAt: { lt: importSince },
          practiceSessionId: null,
        },
        data: {
          transcriptText: EMPTY_TRANSCRIPT_MARK,
          practiceSessionId: FATHOM_SKIPPED,
        },
      });
    }

    const phase = body.phase === "transcripts" ? "transcripts" : "meetings";
    const afterIso = importSince?.toISOString() || null;

    if (phase === "meetings") {
      let page;
      try {
        page = await listFathomMeetings(apiKey, {
          cursor: body.cursor || null,
          includeTranscript: false,
          createdAfter: afterIso,
        });
      } catch (error) {
        const message =
          error instanceof FathomApiError && error.status === 401
            ? "La API key de Fathom ya no es válida. Vuelve a conectarla."
            : "No se pudieron listar las llamadas de Fathom.";
        return NextResponse.json({ error: message }, { status: 502 });
      }

      const items = page.items || [];
      let imported = 0;
      for (const meeting of items) {
        const title = meetingTitle(meeting);
        const recordedAt = meetingRecordedAt(meeting);
        if (importSince && recordedAt && recordedAt < importSince) continue;

        await prisma.fathomRecording.upsert({
          where: {
            userId_fathomRecordingId: {
              userId,
              fathomRecordingId: meeting.recording_id,
            },
          },
          create: {
            userId,
            connectionId: connection.id,
            fathomRecordingId: meeting.recording_id,
            title,
            shareUrl: meeting.share_url || meeting.url || "",
            recordedAt,
            transcriptText: "",
            transcriptJson: [],
          },
          update: {
            title,
            shareUrl: meeting.share_url || meeting.url || "",
            recordedAt,
          },
        });
        imported += 1;
      }

      const meetingsDone = !page.next_cursor;
      if (meetingsDone) {
        await prisma.fathomConnection.update({
          where: { id: connection.id },
          data: { lastSyncAt: new Date() },
        });
      }

      const remainingTranscripts = await prisma.fathomRecording.count({
        where: pendingTranscriptWhere(userId, importSince),
      });

      return NextResponse.json({
        phase: "meetings",
        imported,
        nextCursor: page.next_cursor || null,
        meetingsDone,
        remainingTranscripts,
        importSince: afterIso,
        nextPhase: meetingsDone ? "transcripts" : "meetings",
      });
    }

    const pending = await prisma.fathomRecording.findMany({
      where: pendingTranscriptWhere(userId, importSince),
      orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
      take: TRANSCRIPT_BATCH,
    });

    if (pending.length === 0) {
      await prisma.fathomConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date() },
      });
      const total = await prisma.fathomRecording.count({
        where: inWindowWhere(userId, importSince),
      });
      return NextResponse.json({
        phase: "transcripts",
        imported: 0,
        skipped: 0,
        remainingTranscripts: 0,
        done: true,
        total,
        importSince: afterIso,
      });
    }

    let imported = 0;
    let skipped = 0;
    for (const row of pending) {
      try {
        const transcript = await getFathomTranscript(apiKey, row.fathomRecordingId);
        const transcriptText = fathomTranscriptToText(transcript, row.title);
        if (!isUsableTranscript(transcriptText)) {
          await prisma.fathomRecording.update({
            where: { id: row.id },
            data: {
              transcriptText: EMPTY_TRANSCRIPT_MARK,
              transcriptJson: transcript as unknown as Prisma.InputJsonValue,
              practiceSessionId: FATHOM_SKIPPED,
              syncedAt: new Date(),
            },
          });
          skipped += 1;
          continue;
        }
        await prisma.fathomRecording.update({
          where: { id: row.id },
          data: {
            transcriptText,
            transcriptJson: transcript as unknown as Prisma.InputJsonValue,
            syncedAt: new Date(),
          },
        });
        imported += 1;
      } catch (error) {
        console.error("fathom transcript fetch", row.fathomRecordingId, error);
        const status = error instanceof FathomApiError ? error.status : 0;
        if (status === 404 || status === 400) {
          await prisma.fathomRecording.update({
            where: { id: row.id },
            data: {
              transcriptText: EMPTY_TRANSCRIPT_MARK,
              practiceSessionId: FATHOM_SKIPPED,
              syncedAt: new Date(),
            },
          });
          skipped += 1;
        }
      }
    }

    if (imported === 0 && skipped === 0) {
      await prisma.fathomRecording.updateMany({
        where: { id: { in: pending.map((row) => row.id) } },
        data: {
          transcriptText: EMPTY_TRANSCRIPT_MARK,
          practiceSessionId: FATHOM_SKIPPED,
          syncedAt: new Date(),
        },
      });
      skipped = pending.length;
    }

    const remainingTranscripts = await prisma.fathomRecording.count({
      where: pendingTranscriptWhere(userId, importSince),
    });

    if (remainingTranscripts === 0) {
      await prisma.fathomConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date() },
      });
    }

    return NextResponse.json({
      phase: "transcripts",
      imported,
      skipped,
      remainingTranscripts,
      done: remainingTranscripts === 0,
      importSince: afterIso,
      nextPhase: remainingTranscripts > 0 ? "transcripts" : null,
    });
  } catch (error) {
    console.error("fathom sync", error);
    return NextResponse.json(
      { error: "No se pudo sincronizar Fathom" },
      { status: 500 },
    );
  }
}

function inWindowWhere(userId: string, importSince: Date | null) {
  return {
    userId,
    ...(importSince
      ? {
          OR: [{ recordedAt: { gte: importSince } }, { recordedAt: null }],
        }
      : {}),
  };
}

function pendingTranscriptWhere(userId: string, importSince: Date | null) {
  return {
    ...inWindowWhere(userId, importSince),
    transcriptText: "",
    practiceSessionId: null,
  };
}
