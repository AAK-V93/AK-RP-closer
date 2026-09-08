import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  FathomApiError,
  getFathomTranscript,
  listFathomMeetings,
  meetingRecordedAt,
  meetingTitle,
} from "@/lib/fathom";
import { fathomTranscriptToText } from "@/lib/fathom-transcript";
import {
  getFathomApiKey,
  getFathomConnection,
  requireFathomUser,
} from "@/lib/fathom-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const TRANSCRIPT_BATCH = 5;

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

    let body: { phase?: string; cursor?: string | null } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const phase = body.phase === "transcripts" ? "transcripts" : "meetings";

    if (phase === "meetings") {
      let page;
      try {
        page = await listFathomMeetings(apiKey, {
          cursor: body.cursor || null,
          includeTranscript: false,
        });
      } catch (error) {
        const message =
          error instanceof FathomApiError && error.status === 401
            ? "La API key de Fathom ya no es válida. Vuelve a conectarla."
            : "No se pudieron listar las llamadas de Fathom.";
        return NextResponse.json({ error: message }, { status: 502 });
      }

      const items = page.items || [];
      for (const meeting of items) {
        const title = meetingTitle(meeting);
        const recordedAt = meetingRecordedAt(meeting);
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
      }

      const meetingsDone = !page.next_cursor;
      if (meetingsDone) {
        await prisma.fathomConnection.update({
          where: { id: connection.id },
          data: { lastSyncAt: new Date() },
        });
      }

      const remainingTranscripts = await prisma.fathomRecording.count({
        where: { userId, transcriptText: "" },
      });

      return NextResponse.json({
        phase: "meetings",
        imported: items.length,
        nextCursor: page.next_cursor || null,
        meetingsDone,
        remainingTranscripts,
        nextPhase: meetingsDone ? "transcripts" : "meetings",
      });
    }

    const pending = await prisma.fathomRecording.findMany({
      where: { userId, transcriptText: "" },
      orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
      take: TRANSCRIPT_BATCH,
    });

    if (pending.length === 0) {
      await prisma.fathomConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date() },
      });
      const total = await prisma.fathomRecording.count({ where: { userId } });
      return NextResponse.json({
        phase: "transcripts",
        imported: 0,
        remainingTranscripts: 0,
        done: true,
        total,
      });
    }

    let imported = 0;
    for (const row of pending) {
      try {
        const transcript = await getFathomTranscript(apiKey, row.fathomRecordingId);
        const transcriptText = fathomTranscriptToText(transcript, row.title);
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
      }
    }

    const remainingTranscripts = await prisma.fathomRecording.count({
      where: { userId, transcriptText: "" },
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
      remainingTranscripts,
      done: remainingTranscripts === 0,
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
