import type { PrismaClient } from "@prisma/client";
import { buildExtractorPrompt, enrichExtractorFollowup, parseExtractorJson, type ExtractorJson } from "@/lib/extractor";
import { generateGeminiJson } from "@/lib/gemini";
import { loadOffersForCrm } from "@/lib/crm-apply";
import { userHasReadyCrm } from "@/lib/offer-commercial";
import { isUsableTranscript } from "@/lib/fathom-import";
import {
  hasSalesSignal,
  pickRecording,
  readRecordingOnce,
  recordingDay,
  recordingFicha,
  RECORDING_TRANSCRIPT_LIMIT,
  type RecordingReadState,
  type RecordingRow,
} from "@/lib/recording-ficha";

/** Read-only: finds the recording, reads it with the model if worth it, writes nothing. */
export async function loadRecordingFicha(
  prisma: PrismaClient,
  userId: string,
  target: { callId?: string | null; name?: string | null; day?: string | null },
  now: Date,
) {
  const [fathom, uploads] = await Promise.all([
    prisma.fathomRecording.findMany({
      where: { userId },
      orderBy: { recordedAt: "desc" },
      take: 500,
      select: { id: true, title: true, recordedAt: true },
    }),
    prisma.clientTranscript.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, title: true, createdAt: true },
    }),
  ]);
  const rows: RecordingRow[] = [
    ...fathom.map((row) => ({ id: row.id, kind: "fathom" as const, title: row.title, recordedAt: row.recordedAt, transcript: "" })),
    ...uploads.map((row) => ({ id: row.id, kind: "upload" as const, title: row.title, recordedAt: row.createdAt, transcript: "" })),
  ];
  const picked = pickRecording(rows, target);
  if (!picked) return null;
  // Only the picked recording's transcript is loaded (they are long).
  const text =
    picked.kind === "fathom"
      ? (await prisma.fathomRecording.findFirst({ where: { id: picked.id, userId }, select: { transcriptText: true } }))?.transcriptText
      : (await prisma.clientTranscript.findFirst({ where: { id: picked.id, userId }, select: { transcriptText: true } }))?.transcriptText;
  const row: RecordingRow = { ...picked, transcript: String(text || "") };
  const name = String(target.name || "").trim() || row.title;
  const filed = Boolean(
    await prisma.callRecord.findFirst({ where: { userId, source: row.kind, sourceId: row.id }, select: { id: true } }),
  );

  let state: RecordingReadState;
  let parsed: ExtractorJson | null = null;
  if (!isUsableTranscript(row.transcript)) state = "no-transcript";
  else if (!hasSalesSignal(row.transcript)) state = "no-signal";
  else {
    parsed = await readRecordingOnce(`${userId}:${row.kind}:${row.id}`, () => readRecording(prisma, userId, row));
    state = parsed ? "read" : "failed";
  }
  return recordingFicha({ name, row, parsed, state, filed, now });
}

async function readRecording(prisma: PrismaClient, userId: string, row: RecordingRow): Promise<ExtractorJson | null> {
  const offers = await loadOffersForCrm(prisma, userId);
  const transcript = row.transcript.slice(0, RECORDING_TRANSCRIPT_LIMIT);
  const prompt = buildExtractorPrompt({
    offers,
    title: row.title,
    fechaLlamada: recordingDay(row) || null,
    transcript,
    readyCrm: userHasReadyCrm(offers),
  });
  const text = await generateGeminiJson(prompt, 0.1, 4096, {
    timeoutMs: 18_000,
    models: ["gemini-flash-latest", "gemini-flash-lite-latest"],
  });
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/u, "").trim();
  return enrichExtractorFollowup(parseExtractorJson(JSON.parse(cleaned)), { transcript, callAt: row.recordedAt });
}
