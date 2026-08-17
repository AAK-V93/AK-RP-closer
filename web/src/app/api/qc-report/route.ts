import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { generateGeminiJson } from "@/lib/gemini";
import { buildQcReportPrompt } from "@/lib/qc-prompt";
import {
  formatParsedTranscript,
  parseCallTranscript,
} from "@/lib/parse-transcript";
import {
  FREE_QC_USED_CODE,
  assertGuestCanRunQc,
  markGuestQcCompleted,
} from "@/lib/guest-practice";
import type { QcCallReport } from "@/data/qc-report";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CHARS = 80_000;

function emptyBlock() {
  return {
    whatHappened: "",
    whatScriptAsked: "",
    feedback: "",
    missingQuestion: "",
  };
}

function normalizeReport(parsed: Partial<QcCallReport>): QcCallReport {
  const file = parsed.prospectFile;
  const discovery = parsed.discovery;
  const notes = parsed.prospectNotes;
  return {
    headline: parsed.headline || "Reporte de la llamada",
    durationMinutes: parsed.durationMinutes ?? null,
    sold: Boolean(parsed.sold),
    commitment: parsed.commitment || "",
    overallScore: Number(parsed.overallScore) || 0,
    prospectFile: {
      demographic: file?.demographic || "",
      psychographic: file?.psychographic || "",
      qualification: {
        problemCost: file?.qualification?.problemCost || "",
        priorAttempts: file?.qualification?.priorAttempts || "",
        moneyAlreadySpent: file?.qualification?.moneyAlreadySpent || "",
        ownUrgency: file?.qualification?.ownUrgency || "",
        decisionAuthority: file?.qualification?.decisionAuthority || "",
        offerFit: file?.qualification?.offerFit || "",
      },
      paymentCapacity: file?.paymentCapacity || "",
      howOfferEntered: file?.howOfferEntered || "",
      moneyFrame: file?.moneyFrame || "",
      paymentVerdict: file?.paymentVerdict || "",
    },
    discovery: {
      discoveryPercent: Number(discovery?.discoveryPercent) || 0,
      pitchPercent: Number(discovery?.pitchPercent) || 0,
      rapport: discovery?.rapport || emptyBlock(),
      problemPain: discovery?.problemPain || emptyBlock(),
      pastSolutions: discovery?.pastSolutions || emptyBlock(),
      desiredSituation: discovery?.desiredSituation || emptyBlock(),
      blockScore: Number(discovery?.blockScore) || 0,
    },
    pitch: {
      summary: parsed.pitch?.summary || "",
      blockScore: Number(parsed.pitch?.blockScore) || 0,
    },
    objections: parsed.objections ?? [],
    rootObjection: parsed.rootObjection || "",
    missingAgreements: parsed.missingAgreements ?? [],
    discoveryFailures: parsed.discoveryFailures ?? [],
    verdictLevers: parsed.verdictLevers ?? [],
    prospectNotes: {
      durationAndParticipants: notes?.durationAndParticipants || "",
      whyBooked: notes?.whyBooked || "",
      problemAndPain: notes?.problemAndPain ?? [],
      currentSituation: notes?.currentSituation ?? [],
      context: notes?.context || "",
      feelingsAndFears: notes?.feelingsAndFears || "",
      currentEfforts: notes?.currentEfforts ?? [],
      pastSolutions: notes?.pastSolutions ?? [],
      timeAndUrgency: notes?.timeAndUrgency || "",
      desires: notes?.desires ?? [],
      investmentAndDecider: notes?.investmentAndDecider || "",
      programPresented: notes?.programPresented || "",
      expectations: notes?.expectations || "",
      outcomeAndNextSteps: notes?.outcomeAndNextSteps || "",
      followUpAngle: notes?.followUpAngle || "",
      reusableQuotes: notes?.reusableQuotes ?? [],
    },
  };
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      const gate = await assertGuestCanRunQc(request);
      if (!gate.ok) {
        return NextResponse.json(
          {
            error:
              "Ya usaste tu reporte gratis. Crea una cuenta para auditar más llamadas.",
            code: FREE_QC_USED_CODE,
          },
          { status: 403 },
        );
      }
    }

    const body = (await request.json()) as {
      transcript?: string;
      closerName?: string;
      productName?: string;
    };
    const raw = body.transcript?.trim() || "";
    if (raw.length < 200) {
      return NextResponse.json(
        { error: "Pega una transcripción más larga (mínimo unas cuantas intervenciones)." },
        { status: 400 },
      );
    }

    const parsed = parseCallTranscript(raw.slice(0, MAX_CHARS));
    if (parsed.lines.length < 4) {
      return NextResponse.json(
        {
          error:
            "No pude leer la transcripción. Pega el texto de Fathom (con nombres y timestamps) o un diálogo Closer/Prospecto.",
        },
        { status: 400 },
      );
    }

    const transcript = formatParsedTranscript(parsed);
    const prompt = buildQcReportPrompt({
      transcript,
      closerHint: body.closerName,
      productHint: body.productName,
      speakers: parsed.speakers,
    });

    let text: string;
    try {
      text = await generateGeminiJson(prompt, 0.25, 8192);
    } catch (geminiError) {
      return NextResponse.json(
        {
          error: "No se pudo generar el reporte",
          details:
            geminiError instanceof Error ? geminiError.message : String(geminiError),
        },
        { status: 502 },
      );
    }

    let parsedJson: Partial<QcCallReport>;
    try {
      parsedJson = JSON.parse(text) as Partial<QcCallReport>;
    } catch {
      return NextResponse.json(
        { error: "El modelo devolvió un reporte inválido. Intenta de nuevo." },
        { status: 502 },
      );
    }
    const report = normalizeReport(parsedJson);

    let saved = false;
    const dbUserId = session?.user?.id;
    const prisma = getPrisma();
    if (dbUserId && prisma) {
      try {
        await prisma.practiceSession.create({
          data: {
            userId: dbUserId,
            callSection: "qc_transcript",
            productName: body.productName?.trim() || report.headline.slice(0, 80),
            difficulty: "real",
            language: "es",
            overallScore: report.overallScore,
            outcomeSummary: report.headline,
            transcript: parsed.lines as unknown as Prisma.InputJsonValue,
            evaluation: JSON.parse(JSON.stringify(report)) as Prisma.InputJsonValue,
            criterionScores: [
              {
                id: "pain",
                label: "Descubrimiento",
                score: report.discovery.blockScore,
                maxScore: 10,
                feedback: report.discovery.problemPain.feedback,
              },
              {
                id: "use_discovery",
                label: "Pitch y objeciones",
                score: report.pitch.blockScore,
                maxScore: 10,
                feedback: report.pitch.summary.slice(0, 280),
              },
            ] as Prisma.InputJsonValue,
            scored: true,
          },
        });
        saved = true;
      } catch (saveError) {
        console.error("Could not save QC report", saveError);
      }
    }

    let freeQcUsed = false;
    if (!dbUserId) {
      try {
        await markGuestQcCompleted(request);
        freeQcUsed = true;
      } catch (guestError) {
        console.error("Could not mark free QC", guestError);
      }
    }

    return NextResponse.json({ ...report, saved, freeQcUsed });
  } catch (error) {
    return NextResponse.json(
      {
        error: "No se pudo armar el reporte",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
