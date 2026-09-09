import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import {
  generateQcReportFromTranscript,
  saveQcPracticeSession,
} from "@/lib/qc-report-service";
import { requireFathomUser, getFathomConnection } from "@/lib/fathom-auth";
import {
  EMPTY_TRANSCRIPT_MARK,
  FATHOM_SKIPPED,
  isUsableTranscript,
  parseImportSince,
} from "@/lib/fathom-import";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    const connection = await getFathomConnection(prisma, userId);
    const importSince = parseImportSince(
      connection?.importSince?.toISOString() || null,
    );

    const pending = await prisma.fathomRecording.findFirst({
      where: pendingAnalyzeWhere(userId, importSince),
      orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
    });

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
      return skipResponse(prisma, userId, importSince, pending, "Transcripción demasiado corta");
    }

    try {
      const { report, lines } = await generateQcReportFromTranscript({
        transcriptRaw: pending.transcriptText,
        productName: pending.title,
      });
      const sessionId = await saveQcPracticeSession(prisma, userId, {
        report,
        lines,
        productName: pending.title,
      });
      await prisma.fathomRecording.update({
        where: { id: pending.id },
        data: { practiceSessionId: sessionId },
      });

      const remaining = await prisma.fathomRecording.count({
        where: pendingAnalyzeWhere(userId, importSince),
      });
      const analyzed = await countAnalyzed(prisma, userId, importSince);
      return NextResponse.json({
        imported: 1,
        skipped: 0,
        remaining,
        analyzed,
        done: remaining === 0,
        recording: {
          id: pending.id,
          title: pending.title,
          practiceSessionId: sessionId,
        },
      });
    } catch (error) {
      console.error("fathom analyze", pending.id, error);
      await prisma.fathomRecording.update({
        where: { id: pending.id },
        data: { practiceSessionId: FATHOM_SKIPPED },
      });
      return skipResponse(
        prisma,
        userId,
        importSince,
        pending,
        error instanceof Error ? error.message : "No se pudo auditar",
      );
    }
  } catch (error) {
    console.error("fathom analyze route", error);
    return NextResponse.json(
      { error: "No se pudo auditar las llamadas de Fathom" },
      { status: 500 },
    );
  }
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
