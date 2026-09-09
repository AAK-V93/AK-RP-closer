import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import {
  callDisplayName,
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

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST() {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    const connection = await getFathomConnection(prisma, userId);
    const importSince = parseImportSince(
      connection?.importSince?.toISOString() || null,
    );

    await prisma.fathomRecording.updateMany({
      where: {
        userId,
        practiceSessionId: FATHOM_SKIPPED,
        NOT: { transcriptText: EMPTY_TRANSCRIPT_MARK },
      },
      data: { practiceSessionId: null },
    });

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
      return skipResponse(prisma, userId, importSince, pending, "Sin transcripción");
    }

    const productHint = isGenericMeetingTitle(pending.title)
      ? undefined
      : pending.title;

    try {
      const { report, lines } = await generateQcReportFromTranscript({
        transcriptRaw: pending.transcriptText,
        productName: productHint,
      });
      const title = callDisplayName(report, pending.title);
      const sessionId = await saveQcPracticeSession(prisma, userId, {
        report,
        lines,
        productName: title,
      });
      await prisma.fathomRecording.update({
        where: { id: pending.id },
        data: { practiceSessionId: sessionId, title },
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
          title,
          leadName: report.leadName,
          offerName: report.offerName,
          practiceSessionId: sessionId,
        },
      });
    } catch (error) {
      console.error("fathom analyze", pending.id, error);
      try {
        const report = await extractCallIdentity(pending.transcriptText);
        const title = callDisplayName(report, pending.title);
        const sessionId = await saveQcPracticeSession(prisma, userId, {
          report,
          lines: [],
          productName: title,
        });
        await prisma.fathomRecording.update({
          where: { id: pending.id },
          data: { practiceSessionId: sessionId, title },
        });
        const remaining = await prisma.fathomRecording.count({
          where: pendingAnalyzeWhere(userId, importSince),
        });
        const analyzed = await countAnalyzed(prisma, userId, importSince);
        return NextResponse.json({
          imported: 1,
          skipped: 0,
          partial: true,
          remaining,
          analyzed,
          done: remaining === 0,
          recording: {
            id: pending.id,
            title,
            leadName: report.leadName,
            offerName: report.offerName,
            practiceSessionId: sessionId,
          },
        });
      } catch (identityError) {
        console.error("fathom identity", pending.id, identityError);
        const title = isGenericMeetingTitle(pending.title)
          ? "Lead · oferta por confirmar"
          : pending.title;
        const sessionId = await saveQcPracticeSession(prisma, userId, {
          report: normalizeQcReport({
            headline: "Se guardó la llamada. Re-auditar desde el coach si hace falta.",
          }),
          lines: [],
          productName: title,
        });
        await prisma.fathomRecording.update({
          where: { id: pending.id },
          data: { practiceSessionId: sessionId, title },
        });
        const remaining = await prisma.fathomRecording.count({
          where: pendingAnalyzeWhere(userId, importSince),
        });
        const analyzed = await countAnalyzed(prisma, userId, importSince);
        return NextResponse.json({
          imported: 1,
          skipped: 0,
          partial: true,
          remaining,
          analyzed,
          done: remaining === 0,
          recording: { id: pending.id, title, practiceSessionId: sessionId },
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
