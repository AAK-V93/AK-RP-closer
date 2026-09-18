import type { ParsedLine } from "@/lib/parse-transcript";

export function normalizeFathomTranscriptItems(
  raw: unknown,
): FathomTranscriptItem[] {
  if (Array.isArray(raw)) {
    return raw
      .map(normalizeFathomTranscriptItem)
      .filter((row): row is FathomTranscriptItem => Boolean(row));
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    return text
      ? [{ speaker: { display_name: "Speaker" }, text, timestamp: "00:00:00" }]
      : [];
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.transcript)) {
      return normalizeFathomTranscriptItems(obj.transcript);
    }
    if (Array.isArray(obj.items)) {
      return normalizeFathomTranscriptItems(obj.items);
    }
    if (obj.data && typeof obj.data === "object") {
      return normalizeFathomTranscriptItems(obj.data);
    }
  }
  return [];
}

function normalizeFathomTranscriptItem(row: unknown): FathomTranscriptItem | null {
  if (!row || typeof row !== "object") return null;
  const obj = row as Record<string, unknown>;
  const text = String(obj.text || obj.content || obj.utterance || "").trim();
  if (!text) return null;
  const speaker = obj.speaker;
  let display = "Speaker";
  if (typeof speaker === "string" && speaker.trim()) display = speaker.trim();
  else if (speaker && typeof speaker === "object") {
    const named = speaker as { display_name?: string; name?: string };
    display = String(named.display_name || named.name || "Speaker").trim() || "Speaker";
  } else if (obj.speaker_name) {
    display = String(obj.speaker_name).trim() || "Speaker";
  }
  return {
    speaker: { display_name: display },
    text,
    timestamp: String(obj.timestamp || obj.ts || ""),
  };
}

export type FathomTranscriptItem = {
  speaker?: {
    display_name?: string;
    matched_calendar_invitee_email?: string | null;
  };
  text?: string;
  timestamp?: string;
};

export function fathomTranscriptToLines(
  items: FathomTranscriptItem[] | null | undefined,
): ParsedLine[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const text = String(item.text || "").trim();
      if (!text) return null;
      const speaker = String(item.speaker?.display_name || "Speaker").trim();
      const timestamp = item.timestamp ? normalizeTimestamp(item.timestamp) : null;
      return { timestamp, speaker, text } satisfies ParsedLine;
    })
    .filter((line): line is ParsedLine => Boolean(line));
}

export function fathomTranscriptToText(
  items: FathomTranscriptItem[] | null | undefined,
  title?: string,
) {
  const lines = fathomTranscriptToLines(items);
  const header = title?.trim() ? `${title.trim()}\n\n` : "";
  const body = lines
    .map((line) => {
      const ts = line.timestamp ? `[${line.timestamp}] ` : "";
      return `${ts}${line.speaker}: ${line.text}`;
    })
    .join("\n");
  return `${header}${body}`.trim();
}

function normalizeTimestamp(value: string) {
  const parts = value.trim().split(":").map((part) => part.padStart(2, "0"));
  if (parts.length === 2) return `${parts[0]}:${parts[1]}`;
  if (parts.length >= 3) return `${parts[0]}:${parts[1]}:${parts[2]}`;
  return value.trim();
}
