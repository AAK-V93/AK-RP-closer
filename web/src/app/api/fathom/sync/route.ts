import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  FathomApiError,
  getFathomTranscript,
  listFathomMeetings,
  meetingRecordedAt,
  meetingTitle,
  normalizeFathomRecordingId,
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
import {
  saveFathomRecording,
  skipFathomRecordingsBefore,
  unskipEmptyTranscriptsForImport,
} from "@/lib/fathom-ingest";
import { prismaErrorCode } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const TRANSCRIPT_BATCH = 2;

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
        { error: "No pude leer la API key. Desconecta Fathom y pégala otra vez." },
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
      await skipFathomRecordingsBefore(prisma, userId, importSince);
    }
    const phase = body.phase === "transcripts" ? "transcripts" : "meetings";
    if (phase === "meetings" && !body.cursor) {
      await unskipEmptyTranscriptsForImport(prisma, userId, importSince);
    }
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
            : error instanceof FathomApiError
              ? `Fathom no listó las llamadas (${error.status}).`
              : "No se pudieron listar las llamadas de Fathom.";
        return NextResponse.json({ error: message }, { status: 502 });
      }

      const items = page.items || [];
      let imported = 0;
      for (const meeting of items) {
        const recordingId = normalizeFathomRecordingId(meeting.recording_id);
        if (!recordingId) continue;
        const title = meetingTitle(meeting);
        const recordedAt = meetingRecordedAt(meeting);
        if (importSince && recordedAt && recordedAt < importSince) continue;

        try {
          await saveFathomRecording(prisma, {
            userId,
            connectionId: connection.id,
            fathomRecordingId: recordingId,
            title,
            shareUrl: meeting.share_url || meeting.url || "",
            recordedAt,
          });
          imported += 1;
        } catch (error) {
          console.error("fathom upsert", recordingId, error);
        }
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
      orderBy: [{ syncedAt: "asc" }, { recordedAt: "desc" }],
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
    let throttled = false;
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
        if (status === 429 || status >= 500 || status === 0) {
          throttled = true;
          await prisma.fathomRecording.update({
            where: { id: row.id },
            data: { syncedAt: new Date() },
          });
          break;
        }
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
      waitMs: throttled && imported === 0 && skipped === 0 ? 8_000 : 0,
      done: remainingTranscripts === 0,
      importSince: afterIso,
      nextPhase: remainingTranscripts > 0 ? "transcripts" : null,
    });
  } catch (error) {
    console.error("fathom sync", error);
    return NextResponse.json(
      { error: syncErrorMessage(error) },
      { status: 500 },
    );
  }
}

function syncErrorMessage(error: unknown) {
  const code = prismaErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  if (/decrypt|auth tag|Unsupported state|AUTH_SECRET/i.test(message)) {
    return "No pude leer la API key. Desconecta Fathom y pégala otra vez.";
  }
  if (/int4|integer|does not fit|overflow/i.test(message)) {
    return "El ID de una llamada de Fathom no se pudo guardar. Recarga e intenta de nuevo.";
  }
  if (code === "P2002") return "Esa llamada ya estaba importada. Intenta de nuevo.";
  if (code === "P1001") {
    return "La base de datos no respondió. Intenta de nuevo.";
  }
  if (code === "TX" || /transaction/i.test(message)) {
    return "No se pudo escribir el lote de llamadas. Recarga e intenta de nuevo.";
  }
  if (code === "P2011" || /argument.*(missing|invalid)/i.test(message)) {
    return "Fathom mandó una llamada sin ID. Intenta de nuevo o achica el rango de fechas.";
  }
  return "No se pudo sincronizar Fathom";
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
