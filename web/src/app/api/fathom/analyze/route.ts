import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import {
  callDisplayName,
  coerceTranscriptText,
  extractCallIdentity,
  generateQcReportFromTranscript,
  normalizeQcReport,
  saveQcPracticeSession,
} from "@/lib/qc-report-service";
import { requireFathomUser, getFathomConnection } from "@/lib/fathom-auth";
import {
  EMPTY_TRANSCRIPT_MARK,
  FATHOM_SKIPPED,
  isGenericMeetingTitle,
  isUsableTranscript,
  parseImportSince,
} from "@/lib/fathom-import";
import { fileCallQuietly } from "@/lib/file-call";
import {
  requeuePartialFathomQc,
  unskipFathomIfHasTranscript,
  unskipRecentEmptyTranscripts,
} from "@/lib/fathom-ingest";
import {
  fathomTranscriptToLines,
  normalizeFathomTranscriptItems,
} from "@/lib/fathom-transcript";
import { parseCallTranscript, type ParsedLine } from "@/lib/parse-transcript";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    let body: { recordingId?: string; practiceSessionId?: string } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const connection = await getFathomConnection(prisma, userId);
    const importSince = parseImportSince(
      connection?.importSince?.toISOString() || null,
    );

    const targeted = body.recordingId
      ? await prisma.fathomRecording.findFirst({
          where: { id: body.recordingId, userId },
        })
      : body.practiceSessionId
        ? await prisma.fathomRecording.findFirst({
            where: { userId, practiceSessionId: body.practiceSessionId },
          })
        : null;

    await unskipFathomIfHasTranscript(prisma, userId);
    await unskipRecentEmptyTranscripts(prisma, userId);
    await requeuePartialFathomQc(prisma, userId);

    const pending =
      targeted ||
      (await prisma.fathomRecording.findFirst({
        where: pendingAnalyzeWhere(userId, importSince),
        orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
      }));

    if (!pending) {
      const remaining = await prisma.fathomRecording.count({
        where: pendingAnalyzeWhere(userId, importSince),
      });
      const analyzed = await countAnalyzed(prisma, userId, importSince);
      return NextResponse.json({
        imported: 0,
        skipped: 0,
        remaining,
        analyzed,
        done: true,
      });
    }

    if (!isUsableTranscript(pending.transcriptText)) {
      await prisma.fathomRecording.update({
        where: { id: pending.id },
        data: {
          transcriptText: EMPTY_TRANSCRIPT_MARK,
          practiceSessionId: FATHOM_SKIPPED,
        },
      });
      return skipResponse(prisma, userId, importSince, pending, "Sin transcripción");
    }

    const productHint = isGenericMeetingTitle(pending.title)
      ? undefined
      : pending.title;
    const fallbackLines = linesFromRecording(pending);

    try {
      const { report, lines } = await generateQcReportFromTranscript({
        transcriptRaw: pending.transcriptText,
        productName: productHint,
      });
      return finishAnalyze(prisma, userId, importSince, pending, {
        report,
        lines: lines.length ? lines : fallbackLines,
      });
    } catch (error) {
      console.error("fathom analyze", pending.id, error);
      try {
        const { report, lines } = await extractCallIdentity(pending.transcriptText);
        return finishAnalyze(prisma, userId, importSince, pending, {
          report,
          lines: lines.length ? lines : fallbackLines,
          partial: true,
        });
      } catch (identityError) {
        console.error("fathom identity", pending.id, identityError);
        const title = isGenericMeetingTitle(pending.title)
          ? "Lead · oferta por confirmar"
          : pending.title;
        return finishAnalyze(prisma, userId, importSince, pending, {
          report: normalizeQcReport({
            headline: "Se guardó la llamada. Re-auditar desde el coach si hace falta.",
          }),
          lines: fallbackLines,
          productName: title,
          partial: true,
        });
      }
    }
  } catch (error) {
    console.error("fathom analyze route", error);
    return NextResponse.json(
      { error: "No se pudo auditar las llamadas de Fathom" },
      { status: 500 },
    );
  }
}

function linesFromRecording(pending: {
  transcriptText: string;
  transcriptJson: unknown;
}): ParsedLine[] {
  const parsed = parseCallTranscript(coerceTranscriptText(pending.transcriptText));
  if (parsed.lines.length >= 2) return parsed.lines;
  const fromJson = fathomTranscriptToLines(
    normalizeFathomTranscriptItems(pending.transcriptJson),
  );
  return fromJson.length ? fromJson : parsed.lines;
}

async function finishAnalyze(
  prisma: PrismaClient,
  userId: string,
  importSince: Date | null,
  pending: {
    id: string;
    title: string;
    transcriptText: string;
    recordedAt: Date | null;
  },
  args: {
    report: ReturnType<typeof normalizeQcReport>;
    lines: ParsedLine[];
    productName?: string;
    partial?: boolean;
  },
) {
  const title = callDisplayName(args.report, args.productName || pending.title);
  const sessionId = await saveQcPracticeSession(prisma, userId, {
    report: args.report,
    lines: args.lines,
    productName: title,
  });
  await prisma.fathomRecording.update({
    where: { id: pending.id },
    data: { practiceSessionId: sessionId, title },
  });
  void fileCallQuietly(prisma, userId, {
    source: "fathom",
    sourceId: pending.id,
    title,
    transcript: pending.transcriptText,
    recordedAt: pending.recordedAt,
  });

  const remaining = await prisma.fathomRecording.count({
    where: pendingAnalyzeWhere(userId, importSince),
  });
  const analyzed = await countAnalyzed(prisma, userId, importSince);
  return NextResponse.json({
    imported: 1,
    skipped: 0,
    partial: Boolean(args.partial),
    remaining,
    analyzed,
    done: remaining === 0,
    recording: {
      id: pending.id,
      title,
      leadName: args.report.leadName,
      offerName: args.report.offerName,
      practiceSessionId: sessionId,
    },
  });
}

function pendingAnalyzeWhere(userId: string, importSince: Date | null) {
  return {
    userId,
    transcriptText: { not: "" },
    practiceSessionId: null,
    ...(importSince
      ? { OR: [{ recordedAt: { gte: importSince } }, { recordedAt: null }] }
      : {}),
  };
}

async function countAnalyzed(
  prisma: PrismaClient,
  userId: string,
  importSince: Date | null,
) {
  return prisma.fathomRecording.count({
    where: {
      userId,
      AND: [
        { practiceSessionId: { not: null } },
        { practiceSessionId: { not: FATHOM_SKIPPED } },
      ],
      ...(importSince
        ? { OR: [{ recordedAt: { gte: importSince } }, { recordedAt: null }] }
        : {}),
    },
  });
}

async function skipResponse(
  prisma: PrismaClient,
  userId: string,
  importSince: Date | null,
  pending: { id: string; title: string },
  reason: string,
) {
  const remaining = await prisma.fathomRecording.count({
    where: pendingAnalyzeWhere(userId, importSince),
  });
  const analyzed = await countAnalyzed(prisma, userId, importSince);
  return NextResponse.json({
    imported: 0,
    skipped: 1,
    remaining,
    analyzed,
    done: remaining === 0,
    recording: {
      id: pending.id,
      title: pending.title,
      skipped: true,
      reason,
    },
  });
}
