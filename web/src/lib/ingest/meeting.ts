// Pure mapping from a Fathom meeting or an uploaded transcript to what we store
// (plan 1.1): durationSec is computed HERE, once, and never at read time.
import { createHash } from "crypto";
import { linesFromRawTranscript } from "@/lib/parse-transcript";
import type { FathomMeeting } from "./fathom-api";

export type Invitee = { name: string | null; email: string | null };

export type IngestInput = {
  source: "FATHOM" | "UPLOAD";
  sourceId: string;
  title: string;
  shareUrl: string | null;
  recordedAt: Date;
  durationSec: number | null;
  /** Fathom default summary (English Markdown), null when Fathom gave none */
  summaryEn: string | null;
  /** one line per action item «[HH:MM:SS] (responsable) texto» */
  actionItemsEn: string | null;
  /** «[HH:MM:SS] Hablante: texto» per line; stored once in CallTranscript */
  transcriptText: string | null;
  /** people outside the closer's team (lead candidates) */
  invitees: Invitee[];
};

const MAX_TRANSCRIPT_CHARS = 400_000;
const MAX_DURATION_SEC = 12 * 3600;

/** «HH:MM:SS», «MM:SS» or «H:MM:SS(.mmm)» → seconds */
export function timestampSeconds(ts: string | null | undefined): number | null {
  const m = String(ts ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?$/);
  if (!m) return null;
  return m[3] !== undefined ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
}

export function hms(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

const validDate = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t) : null;
};

/** recording end − start; else the last transcript timestamp; else null. */
export function durationFrom(start: Date | null, end: Date | null, timestamps: Array<string | null | undefined>): number | null {
  if (start && end) {
    const sec = Math.round((end.getTime() - start.getTime()) / 1000);
    if (sec > 0 && sec <= MAX_DURATION_SEC) return sec;
  }
  let last: number | null = null;
  for (const ts of timestamps) {
    const s = timestampSeconds(ts);
    if (s !== null && (last === null || s > last)) last = s;
  }
  return last !== null && last > 0 && last <= MAX_DURATION_SEC ? last : null;
}

/** Fathom recording_id; the docs' own webhook example has none, so fall back to its link. */
export function fathomSourceId(m: FathomMeeting): string | null {
  const raw = m.recording_id;
  const id = typeof raw === "number" ? String(Math.trunc(raw)) : String(raw ?? "").trim();
  if (/^\d+$/.test(id)) return id;
  const link = (m.share_url || m.url || "").trim();
  return link ? `url:${link}` : null;
}

const clean = (v: string | null | undefined) => {
  const s = String(v ?? "").trim();
  return s || null;
};

export function fathomTranscriptText(m: FathomMeeting): string | null {
  const rows = Array.isArray(m.transcript) ? m.transcript : [];
  const lines = rows
    .map((r) => {
      const text = clean(r?.text);
      if (!text) return null;
      const sec = timestampSeconds(r?.timestamp);
      const who = clean(r?.speaker?.display_name) ?? "Hablante";
      return `${sec !== null ? `[${hms(sec)}] ` : ""}${who}: ${text.replace(/\s+/g, " ")}`;
    })
    .filter((l): l is string => l !== null);
  return lines.length ? lines.join("\n").slice(0, MAX_TRANSCRIPT_CHARS) : null;
}

export function fathomActionItems(m: FathomMeeting): string | null {
  const rows = Array.isArray(m.action_items) ? m.action_items : [];
  const lines = rows
    .map((a) => {
      const text = clean(a?.description);
      if (!text) return null;
      const ts = clean(a?.recording_timestamp);
      const who = clean(a?.assignee?.name);
      return `${ts ? `[${ts}] ` : ""}${who ? `(${who}) ` : ""}${text}`;
    })
    .filter((l): l is string => l !== null);
  return lines.length ? lines.join("\n") : null;
}

export function fathomInvitees(m: FathomMeeting): Invitee[] {
  const own = clean(m.recorded_by?.email)?.toLowerCase();
  const seen = new Set<string>();
  const out: Invitee[] = [];
  for (const i of Array.isArray(m.calendar_invitees) ? m.calendar_invitees : []) {
    if (!i || i.is_external !== true) continue;
    const email = clean(i.email)?.toLowerCase() ?? null;
    if (email && email === own) continue;
    const key = email ?? clean(i.name) ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: clean(i.name), email });
  }
  return out;
}

export function fromFathomMeeting(m: FathomMeeting, now = new Date()): IngestInput | null {
  const sourceId = fathomSourceId(m);
  if (!sourceId) return null;
  const start = validDate(m.recording_start_time);
  const end = validDate(m.recording_end_time);
  const transcript = Array.isArray(m.transcript) ? m.transcript : [];
  return {
    source: "FATHOM",
    sourceId,
    title: (clean(m.meeting_title) ?? clean(m.title) ?? "Llamada").slice(0, 200),
    shareUrl: clean(m.share_url) ?? clean(m.url),
    recordedAt: start ?? validDate(m.scheduled_start_time) ?? validDate(m.created_at) ?? now,
    durationSec: durationFrom(start, end, transcript.map((r) => r?.timestamp)),
    summaryEn: clean(m.default_summary?.markdown_formatted),
    actionItemsEn: fathomActionItems(m),
    transcriptText: fathomTranscriptText(m),
    invitees: fathomInvitees(m),
  };
}

// ---------- upload (.txt / .vtt / .srt or pasted text) ----------

/** WebVTT / SRT cues → «[HH:MM:SS] Hablante: texto» lines; plain text passes through. */
export function subtitlesToText(raw: string): string {
  const text = raw.replace(/\r/g, "").replace(/^\uFEFF/, "");
  if (!/-->/.test(text)) return text;
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const cueAt = lines.findIndex((l) => l.includes("-->"));
    if (cueAt < 0) continue;
    const start = lines[cueAt].split("-->")[0].trim().replace(",", ".");
    const sec = timestampSeconds(start.replace(/\.\d+$/, "")) ?? timestampSeconds(start);
    const body = lines
      .slice(cueAt + 1)
      .join(" ")
      .replace(/<v\s+([^>]+)>/g, "$1: ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!body) continue;
    const hasSpeaker = /^[^:]{1,60}:\s/.test(body);
    out.push(`${sec !== null ? `[${hms(sec)}] ` : ""}${hasSpeaker ? body : `Llamada: ${body}`}`);
  }
  return out.join("\n");
}

export function fromUpload(raw: string, opts: { title?: string | null; recordedAt?: Date | null }, now = new Date()): IngestInput | null {
  const lines = linesFromRawTranscript(subtitlesToText(raw));
  if (!lines.length) return null;
  const text = lines
    .map((l) => {
      const sec = timestampSeconds(l.timestamp);
      return `${sec !== null ? `[${hms(sec)}] ` : ""}${l.speaker}: ${l.text.replace(/\s+/g, " ").trim()}`;
    })
    .join("\n")
    .slice(0, MAX_TRANSCRIPT_CHARS);
  if (text.replace(/\s/g, "").length < 40) return null;
  return {
    source: "UPLOAD",
    sourceId: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    title: (clean(opts.title) ?? "Llamada subida").slice(0, 200),
    shareUrl: null,
    recordedAt: opts.recordedAt ?? now,
    durationSec: durationFrom(null, null, lines.map((l) => l.timestamp)),
    summaryEn: null,
    actionItemsEn: null,
    transcriptText: text,
    invitees: [],
  };
}
