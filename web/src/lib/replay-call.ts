import type { PrismaClient } from "@prisma/client";
import type { SpeakerRole } from "@/lib/call-intelligence";
import { EMPTY_TRANSCRIPT_MARK, isUsableTranscript } from "@/lib/fathom-import";
import {
  fathomTranscriptToLines,
  type FathomTranscriptItem,
} from "@/lib/fathom-transcript";
import { parseCallTranscript, type ParsedLine } from "@/lib/parse-transcript";

export type ReplayFiling = {
  notasCrm: string;
  razonNoCierre: string;
  etapaPerdida: string;
  ventaTotal: number | null;
  cashCollected: number | null;
  saldoPendiente: number | null;
  modoPago: string;
  producto: string;
};

export type ReplayCall = {
  source: "fathom" | "upload";
  sourceId: string;
  title: string;
  leadName: string;
  offerName: string;
  result: string;
  callType: string;
  objections: string;
  summary: string;
  leadLines: string[];
  excerpt: string;
  filing?: ReplayFiling | null;
};

type CallFilingSource = {
  filingJson?: unknown;
  summary?: string | null;
  ventaTotal?: number | null;
  cashCollected?: number | null;
  saldoPendiente?: number | null;
  modoPago?: string | null;
  offerName?: string | null;
} | null;

function filingStr(value: unknown) {
  return String(value || "").trim();
}

function filingNum(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function filingFromCall(call: CallFilingSource): ReplayFiling | null {
  if (!call) return null;
  const row = (call.filingJson || {}) as Record<string, unknown>;
  const filing: ReplayFiling = {
    notasCrm: filingStr(row.notas_crm) || call.summary || "",
    razonNoCierre: filingStr(row.razon_no_cierre),
    etapaPerdida: filingStr(row.etapa_perdida),
    ventaTotal: filingNum(row.venta_total) ?? call.ventaTotal ?? null,
    cashCollected: filingNum(row.cash_collected) ?? call.cashCollected ?? null,
    saldoPendiente: filingNum(row.saldo_pendiente) ?? call.saldoPendiente ?? null,
    modoPago: filingStr(row.modo_pago) || call.modoPago || "",
    producto: filingStr(row.producto) || call.offerName || "",
  };
  const has =
    filing.notasCrm ||
    filing.razonNoCierre ||
    filing.etapaPerdida ||
    filing.ventaTotal != null ||
    filing.cashCollected != null ||
    filing.modoPago;
  return has ? filing : null;
}

const OPEN_RESULTS = new Set(["", "no_cerro", "pendiente", "sin_resultado"]);
const SKIP_TYPES = new Set(["interna", "no_comercial"]);
const CLOSER_SPEAKER = /^(closer|vendedor|seller|host|agent|ak\b)/i;

export function isReplayableResult(result: string, callType: string) {
  if (SKIP_TYPES.has(callType)) return false;
  if (result === "cerro") return false;
  return OPEN_RESULTS.has(result) || !result;
}

function normalizeSpeaker(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string) {
  const left = normalizeSpeaker(a);
  const right = normalizeSpeaker(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/** Fallback when there are no labeled speakers. */
export function extractLeadLines(transcript: string) {
  const lines = String(transcript || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tagged: string[] = [];
  for (const line of lines) {
    const match = line.match(
      /^(?:lead|prospecto|cliente|buyer|prospect|customer)\s*[:\-–]\s*(.+)$/i,
    );
    if (match?.[1]) tagged.push(match[1].trim());
  }
  if (tagged.length >= 2) return tagged.slice(0, 16);
  return lines
    .filter((line) => line.length > 12 && line.length < 220)
    .filter((line) => !/^(closer|vendedor|tú|tu|speaker 1)\s*[:\-–]/i.test(line))
    .slice(0, 10);
}

export function pickLeadLines(
  lines: ParsedLine[],
  args?: { leadName?: string; speakerRoles?: SpeakerRole[] },
) {
  if (!lines.length) return [];
  const speakers = [...new Set(lines.map((line) => line.speaker))];
  const leadNames: string[] = [];

  for (const role of args?.speakerRoles || []) {
    if (role.role === "lead" && role.name.trim()) leadNames.push(role.name);
  }

  const leadName = args?.leadName?.trim();
  if (leadName) {
    const hit = speakers.find((speaker) => namesMatch(speaker, leadName));
    if (hit) leadNames.push(hit);
  }

  if (leadNames.length === 0) {
    const closerFromRoles = (args?.speakerRoles || []).find(
      (role) => role.role === "closer" && role.name.trim(),
    );
    if (closerFromRoles) {
      const other = speakers.find(
        (speaker) => !namesMatch(speaker, closerFromRoles.name),
      );
      if (other) leadNames.push(other);
    }
  }

  if (leadNames.length === 0 && speakers.length === 2) {
    const closer = speakers.find((speaker) => CLOSER_SPEAKER.test(speaker));
    if (closer) {
      leadNames.push(speakers.find((speaker) => speaker !== closer) || "");
    }
  }

  const picked = lines
    .filter((line) => leadNames.some((name) => namesMatch(line.speaker, name)))
    .map((line) => line.text.trim())
    .filter((text) => text.length > 6);

  const unique = [...new Set(picked)].slice(0, 16);
  if (unique.length >= 2) return unique;

  return extractLeadLines(
    lines.map((line) => `${line.speaker}: ${line.text}`).join("\n"),
  );
}

function speakersFromTag(tag: { filingJson?: unknown } | null) {
  const raw = (tag?.filingJson || {}) as { speakers?: SpeakerRole[] };
  if (!Array.isArray(raw.speakers)) return [];
  return raw.speakers
    .map((item) => ({
      name: String(item?.name || "").trim(),
      role: String(item?.role || "").toLowerCase().includes("clos")
        ? ("closer" as const)
        : ("lead" as const),
    }))
    .filter((item) => item.name);
}

function packFromLines(args: {
  source: "fathom" | "upload";
  sourceId: string;
  title: string;
  transcript: string;
  lines: ParsedLine[];
  leadName?: string;
  offerName?: string;
  result?: string;
  callType?: string;
  objections?: string;
  summary?: string;
  speakerRoles?: SpeakerRole[];
  call?: CallFilingSource;
}): ReplayCall | null {
  if (!isUsableTranscript(args.transcript)) return null;
  const leadLines = args.lines.length
    ? pickLeadLines(args.lines, {
        leadName: args.leadName,
        speakerRoles: args.speakerRoles,
      })
    : extractLeadLines(args.transcript);
  const filing = filingFromCall(args.call);
  return {
    source: args.source,
    sourceId: args.sourceId,
    title: args.title,
    leadName: (args.leadName || "").trim() || guessLeadName(args.title),
    offerName: args.offerName || "",
    result: args.result || "no_cerro",
    callType: args.callType || "",
    objections: args.objections || filing?.razonNoCierre || "",
    summary: args.summary || filing?.notasCrm || "",
    leadLines,
    excerpt: args.transcript.replace(/\s+/g, " ").trim().slice(0, 3500),
    filing,
  };
}

function guessLeadName(title: string) {
  const cleaned = title.replace(/impromptu|meeting|zoom|meet|llamada/gi, "").trim();
  return cleaned.slice(0, 80) || "Lead";
}

function offerMatches(
  offerName: string,
  productName: string,
  includeFathom: boolean,
  source: "fathom" | "upload",
  uploadOfferId: string | null,
  activeOfferId: string,
) {
  if (source === "upload") {
    if (uploadOfferId) return uploadOfferId === activeOfferId;
  }
  if (source === "fathom" && includeFathom && !offerName) return true;
  if (!offerName) return source === "upload";
  const a = offerName.toLowerCase();
  const b = productName.toLowerCase();
  return a.includes(b) || b.includes(a);
}

export async function listReplayCalls(
  prisma: PrismaClient,
  userId: string,
  offer: {
    id: string;
    productName: string;
    includeFathom: boolean;
  },
) {
  const [fathom, uploads, tags] = await Promise.all([
    prisma.fathomRecording.findMany({
      where: { userId },
      orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
      take: 80,
      select: {
        id: true,
        title: true,
        recordedAt: true,
        transcriptText: true,
      },
    }),
    prisma.clientTranscript.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        title: true,
        createdAt: true,
        transcriptText: true,
        offerId: true,
      },
    }),
    prisma.callRecord.findMany({ where: { userId } }),
  ]);

  const tagMap = new Map(
    tags.map((row) => [`${row.source}:${row.sourceId}`, row]),
  );

  const rows: {
    source: "fathom" | "upload";
    sourceId: string;
    title: string;
    date: string | null;
    leadName: string;
    offerName: string;
    result: string;
    callType: string;
    objections: string;
    summary: string;
  }[] = [];

  for (const row of fathom) {
    if (row.transcriptText === EMPTY_TRANSCRIPT_MARK) continue;
    if (!isUsableTranscript(row.transcriptText)) continue;
    const tag = tagMap.get(`fathom:${row.id}`);
    if (
      !offerMatches(
        tag?.offerName || "",
        offer.productName,
        offer.includeFathom,
        "fathom",
        null,
        offer.id,
      )
    ) {
      continue;
    }
    const result = tag?.result || "";
    const callType = tag?.callType || "";
    if (!isReplayableResult(result, callType)) continue;
    rows.push({
      source: "fathom",
      sourceId: row.id,
      title: tag?.title || row.title,
      date: row.recordedAt?.toISOString() || null,
      leadName: tag?.leadName || "",
      offerName: tag?.offerName || offer.productName,
      result: result || "no_cerro",
      callType,
      objections: "",
      summary: "",
    });
  }

  for (const row of uploads) {
    if (!isUsableTranscript(row.transcriptText)) continue;
    const tag = tagMap.get(`upload:${row.id}`);
    if (
      !offerMatches(
        tag?.offerName || "",
        offer.productName,
        false,
        "upload",
        row.offerId,
        offer.id,
      )
    ) {
      continue;
    }
    const result = tag?.result || "";
    const callType = tag?.callType || "";
    if (!isReplayableResult(result, callType)) continue;
    rows.push({
      source: "upload",
      sourceId: row.id,
      title: tag?.title || row.title,
      date: row.createdAt.toISOString(),
      leadName: tag?.leadName || "",
      offerName: tag?.offerName || offer.productName,
      result: result || "no_cerro",
      callType,
      objections: "",
      summary: "",
    });
  }

  return rows.slice(0, 40);
}

export async function loadReplayCall(
  prisma: PrismaClient,
  userId: string,
  source: "fathom" | "upload",
  sourceId: string,
): Promise<ReplayCall | null> {
  const tag = await prisma.callRecord.findFirst({
    where: { userId, source, sourceId },
  });
  const speakerRoles = speakersFromTag(tag);
  if (source === "fathom") {
    const row = await prisma.fathomRecording.findFirst({
      where: { id: sourceId, userId },
    });
    if (!row) return null;
    const jsonLines = fathomTranscriptToLines(
      row.transcriptJson as FathomTranscriptItem[],
    );
    const lines = jsonLines.length
      ? jsonLines
      : parseCallTranscript(row.transcriptText).lines;
    return packFromLines({
      source,
      sourceId,
      title: tag?.title || row.title,
      transcript: row.transcriptText,
      lines,
      leadName: tag?.leadName,
      offerName: tag?.offerName,
      result: tag?.result,
      callType: tag?.callType,
      summary: tag?.summary,
      speakerRoles,
      call: tag,
    });
  }
  const row = await prisma.clientTranscript.findFirst({
    where: { id: sourceId, userId },
  });
  if (!row) return null;
  return packFromLines({
    source,
    sourceId,
    title: tag?.title || row.title,
    transcript: row.transcriptText,
    lines: parseCallTranscript(row.transcriptText).lines,
    leadName: tag?.leadName,
    offerName: tag?.offerName,
    result: tag?.result,
    callType: tag?.callType,
    summary: tag?.summary,
    speakerRoles,
    call: tag,
  });
}
