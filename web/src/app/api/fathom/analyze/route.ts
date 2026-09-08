import { NextResponse } from "next/server";
import {
  generateQcReportFromTranscript,
  saveQcPracticeSession,
} from "@/lib/qc-report-service";
import { requireFathomUser } from "@/lib/fathom-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    const pending = await prisma.fathomRecording.findFirst({
      where: {
        userId,
        transcriptText: { not: "" },
        practiceSessionId: null,
      },
      orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
    });

    if (!pending) {
      const remaining = await prisma.fathomRecording.count({
        where: {
          userId,
          transcriptText: { not: "" },
          practiceSessionId: null,
        },
      });
      const analyzed = await prisma.fathomRecording.count({
        where: { userId, NOT: { practiceSessionId: null } },
      });
      return NextResponse.json({
        imported: 0,
        remaining,
        analyzed,
        done: true,
      });
    }

    let sessionId: string;
    try {
      const { report, lines } = await generateQcReportFromTranscript({
        transcriptRaw: pending.transcriptText,
        productName: pending.title,
      });
      sessionId = await saveQcPracticeSession(prisma, userId, {
        report,
        lines,
        productName: pending.title,
      });
    } catch (error) {
      console.error("fathom analyze", pending.id, error);
      return NextResponse.json(
        {
          error: `No se pudo auditar "${pending.title}". Intenta de nuevo.`,
          details: error instanceof Error ? error.message : String(error),
          recordingId: pending.id,
        },
        { status: 502 },
      );
    }

    await prisma.fathomRecording.update({
      where: { id: pending.id },
      data: { practiceSessionId: sessionId },
    });

    const remaining = await prisma.fathomRecording.count({
      where: {
        userId,
        transcriptText: { not: "" },
        practiceSessionId: null,
      },
    });
    const analyzed = await prisma.fathomRecording.count({
      where: { userId, NOT: { practiceSessionId: null } },
    });

    return NextResponse.json({
      imported: 1,
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
    console.error("fathom analyze route", error);
    return NextResponse.json(
      { error: "No se pudo auditar las llamadas de Fathom" },
      { status: 500 },
    );
  }
}
