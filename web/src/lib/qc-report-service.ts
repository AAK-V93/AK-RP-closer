import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { QcCallReport } from "@/data/qc-report";
import { generateGeminiJson } from "@/lib/gemini";
import { buildQcReportPrompt } from "@/lib/qc-prompt";
import { matchKnownOffer } from "@/data/offer-cases";
import { displayCallTitle } from "@/lib/fathom-import";
import {
  compactTranscriptText,
  formatParsedTranscript,
  parseCallTranscript,
  type ParsedLine,
} from "@/lib/parse-transcript";

const MAX_CHARS = 80_000;

function emptyBlock() {
  return {
    whatHappened: "",
    whatScriptAsked: "",
    feedback: "",
    missingQuestion: "",
  };
}

export function normalizeQcReport(parsed: Partial<QcCallReport>): QcCallReport {
  const file = parsed.prospectFile;
  const discovery = parsed.discovery;
  const notes = parsed.prospectNotes;
  return {
    headline: parsed.headline || "Reporte de la llamada",
    leadName: String(parsed.leadName || "").trim(),
    offerName: String(parsed.offerName || "").trim(),
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

function parseModelJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```$/u, "")
    .trim();
  return JSON.parse(cleaned);
}

export async function generateQcReportFromTranscript(args: {
  transcriptRaw: string;
  closerName?: string;
  productName?: string;
}) {
  const raw = args.transcriptRaw.trim();
  if (raw.length < 80) {
    throw new Error("Transcripción demasiado corta para auditar.");
  }

  const parsed = parseCallTranscript(raw.slice(0, MAX_CHARS));
  if (parsed.lines.length < 2) {
    throw new Error("No pude leer la transcripción.");
  }

  const transcript = compactTranscriptText(formatParsedTranscript(parsed));
  const prompt = buildQcReportPrompt({
    transcript,
    closerHint: args.closerName,
    productHint: args.productName,
    speakers: parsed.speakers,
  });

  const text = await generateGeminiJson(prompt, 0.25, 4096, {
    timeoutMs: 75_000,
    models: ["gemini-flash-latest", "gemini-flash-lite-latest"],
  });

  const parsedJson = parseModelJson(text) as Partial<QcCallReport>;
  const report = enrichCallIdentity(normalizeQcReport(parsedJson), transcript);
  return {
    report,
    lines: parsed.lines as ParsedLine[],
  };
}

export function enrichCallIdentity(report: QcCallReport, transcript: string) {
  const known = matchKnownOffer(`${report.offerName} ${report.headline} ${transcript.slice(0, 2000)}`);
  const offerName = known?.productName || report.offerName;
  const leadName = report.leadName;
  return { ...report, leadName, offerName };
}

export async function extractCallIdentity(transcriptRaw: string) {
  const parsed = parseCallTranscript(transcriptRaw.trim().slice(0, 12_000));
  const transcript = compactTranscriptText(formatParsedTranscript(parsed));
  const text = await generateGeminiJson(
    `Extrae identidad de esta llamada de ventas. JSON: {"leadName":"","offerName":""}.
leadName = prospecto, no el closer. offerName = programa/oferta/plan si se menciona.
Si el título era Impromptu/Meet/Zoom, IGNÓRALO y usa solo el diálogo.
Speakers: ${parsed.speakers.join(" · ") || "desconocidos"}

${transcript}`,
    0.1,
    256,
    { timeoutMs: 20_000, models: ["gemini-flash-lite-latest"] },
  );
  const parsedJson = parseModelJson(text) as { leadName?: string; offerName?: string };
  return enrichCallIdentity(
    normalizeQcReport({
      headline: "QC parcial: se guardó la llamada para no perderla",
      leadName: parsedJson.leadName,
      offerName: parsedJson.offerName,
    }),
    transcript,
  );
}

export function callDisplayName(report: QcCallReport, fallback?: string) {
  return displayCallTitle({
    leadName: report.leadName,
    offerName: report.offerName,
    fallback,
  });
}

export async function saveQcPracticeSession(
  prisma: PrismaClient,
  userId: string,
  args: {
    report: QcCallReport;
    lines: ParsedLine[];
    productName?: string;
  },
) {
  const session = await prisma.practiceSession.create({
    data: {
      userId,
      callSection: "qc_transcript",
      productName:
        callDisplayName(args.report, args.productName) ||
        args.report.headline.slice(0, 80),
      difficulty: "real",
      language: "es",
      overallScore: args.report.overallScore,
      outcomeSummary: args.report.headline,
      transcript: args.lines as unknown as Prisma.InputJsonValue,
      evaluation: JSON.parse(JSON.stringify(args.report)) as Prisma.InputJsonValue,
      criterionScores: [
        {
          id: "pain",
          label: "Descubrimiento",
          score: args.report.discovery.blockScore,
          maxScore: 10,
          feedback: args.report.discovery.problemPain.feedback,
        },
        {
          id: "use_discovery",
          label: "Pitch y objeciones",
          score: args.report.pitch.blockScore,
          maxScore: 10,
          feedback: args.report.pitch.summary.slice(0, 280),
        },
      ] as Prisma.InputJsonValue,
      scored: true,
    },
  });
  return session.id;
}
