import { randomBytes } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { appUrl, isPublicHttpsUrl } from "@/lib/app-url";
import {
  createFathomWebhook,
  deleteFathomWebhook,
  FathomApiError,
  getFathomTranscript,
  listFathomMeetings,
  meetingRecordedAt,
  meetingTitle,
  normalizeFathomRecordingId,
  type FathomMeeting,
} from "@/lib/fathom";
import {
  EMPTY_TRANSCRIPT_MARK,
  FATHOM_SKIPPED,
  isUsableTranscript,
} from "@/lib/fathom-import";
import {
  fathomTranscriptToText,
  normalizeFathomTranscriptItems,
} from "@/lib/fathom-transcript";
import { fileCallQuietly } from "@/lib/file-call";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import { emailConfigured, sendEmail } from "@/lib/email";
import { whatsappClickHref } from "@/lib/whatsapp-link";
import { ensureFathomTables, prismaErrorCode } from "@/lib/prisma";

const POLL_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_POLL_USERS = 8;
const MAX_MEETINGS_PER_USER = 5;
const MAX_FILE_PER_RUN = 2;

export function newFathomWebhookToken() {
  return randomBytes(18).toString("base64url");
}

export function fathomWebhookUrl(token: string) {
  return `${appUrl()}/api/webhooks/fathom/${token}`;
}

export async function ensureFathomWebhook(prisma: PrismaClient, userId: string) {
  const connection = await prisma.fathomConnection.findUnique({ where: { userId } });
  if (!connection) return { ok: false as const, reason: "no-connection" };

  const token = connection.webhookToken || newFathomWebhookToken();
  if (!connection.webhookToken) {
    await prisma.fathomConnection.update({
      where: { id: connection.id },
      data: { webhookToken: token },
    });
  }

  const destination = fathomWebhookUrl(token);
  if (!isPublicHttpsUrl(destination)) {
    return { ok: false as const, reason: "local-url", destination };
  }

  if (connection.webhookId && connection.webhookSecretEnc) {
    return { ok: true as const, reused: true, destination };
  }

  const apiKey = decryptSecret(connection.apiKeyEnc);
  const webhook = await createFathomWebhook(apiKey, { destinationUrl: destination });
  await prisma.fathomConnection.update({
    where: { id: connection.id },
    data: {
      webhookId: webhook.id || "",
      webhookSecretEnc: webhook.secret ? encryptSecret(webhook.secret) : "",
      webhookToken: token,
    },
  });
  return { ok: true as const, reused: false, destination };
}

export async function unregisterFathomWebhook(prisma: PrismaClient, userId: string) {
  const connection = await prisma.fathomConnection.findUnique({ where: { userId } });
  if (!connection?.webhookId) return;
  try {
    const apiKey = decryptSecret(connection.apiKeyEnc);
    await deleteFathomWebhook(apiKey, connection.webhookId);
  } catch (error) {
    console.error("fathom webhook delete", error);
  }
}

export async function saveFathomRecording(
  prisma: PrismaClient,
  args: {
    userId: string;
    connectionId: string;
    fathomRecordingId: string;
    title: string;
    shareUrl: string;
    recordedAt: Date | null;
  },
) {
  const existing = await prisma.fathomRecording.findUnique({
    where: {
      userId_fathomRecordingId: {
        userId: args.userId,
        fathomRecordingId: args.fathomRecordingId,
      },
    },
  });
  if (existing) {
    return prisma.fathomRecording.update({
      where: { id: existing.id },
      data: {
        title: args.title,
        shareUrl: args.shareUrl,
        recordedAt: args.recordedAt,
      },
    });
  }
  try {
    return await prisma.fathomRecording.create({
      data: {
        userId: args.userId,
        connectionId: args.connectionId,
        fathomRecordingId: args.fathomRecordingId,
        title: args.title,
        shareUrl: args.shareUrl,
        recordedAt: args.recordedAt,
        transcriptText: "",
        transcriptJson: [],
      },
    });
  } catch (error) {
    if (prismaErrorCode(error) !== "P2002") throw error;
    return prisma.fathomRecording.update({
      where: {
        userId_fathomRecordingId: {
          userId: args.userId,
          fathomRecordingId: args.fathomRecordingId,
        },
      },
      data: {
        title: args.title,
        shareUrl: args.shareUrl,
        recordedAt: args.recordedAt,
      },
    });
  }
}

/** Neon HTTP rejects Prisma updateMany (it wraps a transaction). */
export async function skipFathomRecordingsBefore(
  prisma: PrismaClient,
  userId: string,
  importSince: Date,
) {
  await prisma.$executeRaw`
    UPDATE "FathomRecording"
    SET "transcriptText" = ${EMPTY_TRANSCRIPT_MARK},
        "practiceSessionId" = ${FATHOM_SKIPPED}
    WHERE "userId" = ${userId}
      AND "practiceSessionId" IS NULL
      AND "recordedAt" IS NOT NULL
      AND "recordedAt" < ${importSince}
  `;
}

export async function markFathomRecordingsSkipped(
  prisma: PrismaClient,
  ids: string[],
) {
  if (!ids.length) return;
  await prisma.$executeRaw`
    UPDATE "FathomRecording"
    SET "transcriptText" = ${EMPTY_TRANSCRIPT_MARK},
        "practiceSessionId" = ${FATHOM_SKIPPED},
        "syncedAt" = NOW()
    WHERE "id" IN (${Prisma.join(ids)})
  `;
}

export async function unskipFathomIfHasTranscript(
  prisma: PrismaClient,
  userId: string,
) {
  await prisma.$executeRaw`
    UPDATE "FathomRecording"
    SET "practiceSessionId" = NULL
    WHERE "userId" = ${userId}
      AND "practiceSessionId" = ${FATHOM_SKIPPED}
      AND "transcriptText" <> ${EMPTY_TRANSCRIPT_MARK}
  `;
}

/** Retry 404/empty skips while Fathom may still be transcribing. */
export async function unskipRecentEmptyTranscripts(
  prisma: PrismaClient,
  userId: string,
) {
  await unskipEmptyTranscriptsForImport(prisma, userId, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
}

/** Re-fetch omitted transcripts in the import date range (or all, if no range). */
export async function unskipEmptyTranscriptsForImport(
  prisma: PrismaClient,
  userId: string,
  importSince: Date | null,
) {
  if (importSince) {
    await prisma.$executeRaw`
      UPDATE "FathomRecording"
      SET "practiceSessionId" = NULL,
          "transcriptText" = ''
      WHERE "userId" = ${userId}
        AND "practiceSessionId" = ${FATHOM_SKIPPED}
        AND "transcriptText" = ${EMPTY_TRANSCRIPT_MARK}
        AND ("recordedAt" IS NULL OR "recordedAt" >= ${importSince})
    `;
    return;
  }
  await prisma.$executeRaw`
    UPDATE "FathomRecording"
    SET "practiceSessionId" = NULL,
        "transcriptText" = ''
    WHERE "userId" = ${userId}
      AND "practiceSessionId" = ${FATHOM_SKIPPED}
      AND "transcriptText" = ${EMPTY_TRANSCRIPT_MARK}
  `;
}

/** QC that saved the call but dropped the transcript (empty lines / 0 score). */
export async function requeuePartialFathomQc(
  prisma: PrismaClient,
  userId: string,
) {
  await prisma.$executeRaw`
    UPDATE "FathomRecording" AS r
    SET "practiceSessionId" = NULL
    FROM "PracticeSession" AS s
    WHERE r."userId" = ${userId}
      AND r."practiceSessionId" = s.id
      AND r."transcriptText" <> ${EMPTY_TRANSCRIPT_MARK}
      AND length(r."transcriptText") >= 80
      AND (
        s."outcomeSummary" ILIKE '%QC parcial%'
        OR s."outcomeSummary" ILIKE '%no perderla%'
        OR s."outcomeSummary" ILIKE '%Re-auditar%'
        OR (
          COALESCE(s."overallScore", 0) = 0
          AND (s."transcript" IS NULL OR s."transcript"::text IN ('[]', 'null'))
        )
      )
  `;
}

export async function ingestFathomMeeting(
  prisma: PrismaClient,
  userId: string,
  meeting: FathomMeeting,
  args: { fileCall?: boolean } = {},
) {
  const connection = await prisma.fathomConnection.findUnique({ where: { userId } });
  if (!connection) return { ok: false as const, reason: "no-connection" };

  const recordingId = normalizeFathomRecordingId(meeting.recording_id);
  if (!recordingId) return { ok: false as const, reason: "no-recording-id" };

  const title = meetingTitle(meeting);
  const recordedAt = meetingRecordedAt(meeting);
  const recording = await saveFathomRecording(prisma, {
    userId,
    connectionId: connection.id,
    fathomRecordingId: recordingId,
    title,
    shareUrl: meeting.share_url || meeting.url || "",
    recordedAt,
  });

  let transcriptItems = normalizeFathomTranscriptItems(meeting.transcript);
  if (transcriptItems.length === 0 && !isUsableTranscript(recording.transcriptText)) {
    try {
      const apiKey = decryptSecret(connection.apiKeyEnc);
      transcriptItems = await getFathomTranscript(apiKey, recordingId);
    } catch (error) {
      const status = error instanceof FathomApiError ? error.status : 0;
      if (status === 404 || status === 400) {
        const young =
          !recordedAt || Date.now() - recordedAt.getTime() < 2 * 24 * 60 * 60 * 1000;
        if (young) {
          return { ok: false as const, reason: "transcript-pending" };
        }
        await prisma.fathomRecording.update({
          where: { id: recording.id },
          data: {
            transcriptText: EMPTY_TRANSCRIPT_MARK,
            practiceSessionId: FATHOM_SKIPPED,
            syncedAt: new Date(),
          },
        });
        return { ok: true as const, recordingId: recording.id, skipped: true, reason: "no-transcript" };
      }
      throw error;
    }
  }

  const transcriptText =
    transcriptItems.length > 0
      ? fathomTranscriptToText(transcriptItems, title)
      : recording.transcriptText;

  if (!isUsableTranscript(transcriptText)) {
    await prisma.fathomRecording.update({
      where: { id: recording.id },
      data: {
        transcriptText: EMPTY_TRANSCRIPT_MARK,
        transcriptJson: transcriptItems as unknown as Prisma.InputJsonValue,
        practiceSessionId: FATHOM_SKIPPED,
        syncedAt: new Date(),
      },
    });
    return { ok: true as const, recordingId: recording.id, skipped: true, reason: "empty-transcript" };
  }

  await prisma.fathomRecording.update({
    where: { id: recording.id },
    data: {
      title,
      transcriptText,
      transcriptJson: (transcriptItems.length
        ? transcriptItems
        : recording.transcriptJson) as Prisma.InputJsonValue,
      practiceSessionId:
        recording.practiceSessionId === FATHOM_SKIPPED ? null : recording.practiceSessionId,
      syncedAt: new Date(),
    },
  });

  await prisma.fathomConnection.update({
    where: { id: connection.id },
    data: { lastSyncAt: new Date() },
  });

  if (args.fileCall === false) {
    return { ok: true as const, recordingId: recording.id, filed: false };
  }

  const already = await prisma.callRecord.findUnique({
    where: {
      userId_source_sourceId: {
        userId,
        source: "fathom",
        sourceId: recording.id,
      },
    },
  });
  if (already) {
    return { ok: true as const, recordingId: recording.id, filed: false, reason: "already-filed" };
  }

  const filed = await fileCallQuietly(prisma, userId, {
    source: "fathom",
    sourceId: recording.id,
    title,
    transcript: transcriptText,
    recordedAt,
  });
  if (filed?.callRecordId) {
    await notifyCloserAfterIngest(prisma, userId, {
      title,
      callRecordId: filed.callRecordId,
      summary: filed.summary,
    }).catch((error) => console.error("fathom ingest notify", error));
  }

  return {
    ok: true as const,
    recordingId: recording.id,
    filed: Boolean(filed),
    callRecordId: filed?.callRecordId || null,
  };
}

export async function pollRecentFathomCalls(prisma: PrismaClient) {
  await ensureFathomTables(prisma);
  const connections = await prisma.fathomConnection.findMany({
    orderBy: { lastSyncAt: "asc" },
    take: MAX_POLL_USERS,
  });
  const since = new Date(Date.now() - POLL_WINDOW_MS).toISOString();
  let ingested = 0;
  let filed = 0;
  let webhooks = 0;

  for (const connection of connections) {
    try {
      const hook = await ensureFathomWebhook(prisma, connection.userId);
      if (hook.ok && !hook.reused) webhooks += 1;
    } catch (error) {
      console.error("fathom ensure webhook", connection.userId, error);
    }

    let apiKey = "";
    try {
      apiKey = decryptSecret(connection.apiKeyEnc);
    } catch (error) {
      console.error("fathom poll decrypt", connection.userId, error);
      continue;
    }

    let meetings: FathomMeeting[] = [];
    try {
      const page = await listFathomMeetings(apiKey, { createdAfter: since });
      meetings = (page.items || []).slice(0, MAX_MEETINGS_PER_USER);
    } catch (error) {
      console.error("fathom poll list", connection.userId, error);
      continue;
    }

    for (const meeting of meetings) {
      try {
        const result = await ingestFathomMeeting(prisma, connection.userId, meeting, {
          fileCall: filed < MAX_FILE_PER_RUN,
        });
        if (result.ok && !("skipped" in result && result.skipped)) ingested += 1;
        if (result.ok && "filed" in result && result.filed) filed += 1;
      } catch (error) {
        console.error("fathom poll ingest", meeting.recording_id, error);
      }
    }
  }

  return { users: connections.length, ingested, filed, webhooks };
}

async function notifyCloserAfterIngest(
  prisma: PrismaClient,
  userId: string,
  args: { title: string; callRecordId: string; summary?: string },
) {
  if (!emailConfigured()) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return;

  const alerts = await prisma.leadAlert.findMany({
    where: {
      userId,
      callRecordId: args.callRecordId,
      resolvedAt: null,
    },
    include: { lead: { select: { name: true, telefono: true } } },
    take: 6,
  });

  const hub = `${appUrl()}/`;
  const leadName = alerts[0]?.lead.name || args.title;
  const lines =
    alerts.length > 0
      ? alerts.map((alert) => {
          const copy = alert.mensajeSugerido || alert.question;
          return `${alert.question}\nWhatsApp: ${whatsappClickHref(alert.lead.telefono, copy)}`;
        })
      : [args.summary || "Revisa Inicio para confirmar el dato que faltó."];

  const subject = `Nueva llamada: ${leadName}`;
  const text = `Hola${user.name ? ` ${user.name}` : ""}.

Entró una llamada de Fathom: ${args.title}

${lines.join("\n\n")}

Marca el CRM en:
${hub}
`;
  await sendEmail({
    to: user.email,
    subject,
    text,
    html: `<p>Hola${user.name ? ` ${escapeHtml(user.name)}` : ""}.</p>
<p>Entró una llamada de Fathom: <strong>${escapeHtml(args.title)}</strong>.</p>
${
  alerts.length
    ? `<ol>${alerts
        .map((alert) => {
          const copy = alert.mensajeSugerido || alert.question;
          const wa = whatsappClickHref(alert.lead.telefono, copy);
          return `<li><p>${escapeHtml(alert.question)}</p><p><a href="${escapeHtml(wa)}">Abrir WhatsApp</a> · <a href="${hub}">Marcar en el CRM</a></p></li>`;
        })
        .join("")}</ol>`
    : `<p>${escapeHtml(args.summary || "Revisa Inicio para confirmar el dato que faltó.")}</p>`
}
<p><a href="${hub}">Abrir Closer Trainer</a></p>`,
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
