import type { ParsedLine } from "@/lib/parse-transcript";

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
