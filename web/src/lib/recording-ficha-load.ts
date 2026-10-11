import type { PrismaClient } from "@prisma/client";
import { buildExtractorPrompt, enrichExtractorFollowup, parseExtractorJson, type ExtractorJson } from "@/lib/extractor";
import { generateGeminiJson } from "@/lib/gemini";
import { loadOffersForCrm } from "@/lib/crm-apply";
import { userHasReadyCrm } from "@/lib/offer-commercial";
import { isUsableTranscript } from "@/lib/fathom-import";
import {
  hasSalesSignal,
  peekRecordingRead,
  pickRecording,
  readRecordingOnce,
  recordingTextFacts,
  rememberRecordingTextFacts,
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
  const picked = await findRecording(prisma, userId, target);
  if (!picked) return null;
  const name = String(target.name || "").trim() || picked.title;
  const key = `${userId}:${picked.kind}:${picked.id}`;
  const filed = Boolean(
    await prisma.callRecord.findFirst({ where: { userId, source: picked.kind, sourceId: picked.id }, select: { id: true } }),
  );

  // The transcript (~50 KB) is downloaded only the first time this ficha is opened (then cached
  // for 30 minutes with the model's reading), never for lists.
  let facts = recordingTextFacts(key);
  let row: RecordingRow = picked;
  const cachedRead = peekRecordingRead(key);
  if (!facts || (facts.usable && facts.signal && !cachedRead)) {
    const text =
      picked.kind === "fathom"
        ? (await prisma.fathomRecording.findFirst({ where: { id: picked.id, userId }, select: { transcriptText: true } }))?.transcriptText
        : (await prisma.clientTranscript.findFirst({ where: { id: picked.id, userId }, select: { transcriptText: true } }))?.transcriptText;
    row = { ...picked, transcript: String(text || "") };
    facts = { usable: isUsableTranscript(row.transcript), signal: hasSalesSignal(row.transcript) };
    rememberRecordingTextFacts(key, facts);
  }

  let state: RecordingReadState;
  let parsed: ExtractorJson | null = null;
  if (!facts.usable) state = "no-transcript";
  else if (!facts.signal) state = "no-signal";
  else {
    const reading = row.transcript ? row : picked;
    parsed = await (cachedRead ?? readRecordingOnce(key, () => readRecording(prisma, userId, reading)));
    state = parsed ? "read" : "failed";
  }
  return recordingFicha({ name, row, parsed, state, filed, now, usable: facts.usable });
}

/** The recording the ficha was opened from: straight by id when it is one, else by name/day. */
async function findRecording(
  prisma: PrismaClient,
  userId: string,
  target: { callId?: string | null; name?: string | null; day?: string | null },
): Promise<RecordingRow | null> {
  const id = String(target.callId || "").trim();
  if (id) {
    const [fathom, upload] = await Promise.all([
      prisma.fathomRecording.findFirst({ where: { id, userId }, select: { id: true, title: true, recordedAt: true } }),
      prisma.clientTranscript.findFirst({ where: { id, userId }, select: { id: true, title: true, createdAt: true } }),
    ]);
    if (fathom) return { id: fathom.id, kind: "fathom", title: fathom.title, recordedAt: fathom.recordedAt, transcript: "" };
    if (upload) return { id: upload.id, kind: "upload", title: upload.title, recordedAt: upload.createdAt, transcript: "" };
  }
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
  return pickRecording(rows, target);
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
