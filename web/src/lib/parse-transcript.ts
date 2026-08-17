export type ParsedLine = {
  timestamp: string | null;
  speaker: string;
  text: string;
};

export type ParsedTranscript = {
  title: string | null;
  durationHint: string | null;
  lines: ParsedLine[];
  speakers: string[];
};

const FATHOM_HEADER = /VIEW RECORDING[\s\S]*?(?:\n---\s*\n|$)/i;
const TIMESTAMP_SPEAKER =
  /^(?:(?:(\d{1,2}:\d{2}(?::\d{2})?)|\[(\d{1,2}:\d{2}(?::\d{2})?)\])\s*[-–—]\s*)?(.+)$/;

function looksLikeSpeaker(line: string) {
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/^---+$/.test(trimmed)) return false;
  return TIMESTAMP_SPEAKER.test(trimmed);
}

export function parseCallTranscript(raw: string): ParsedTranscript {
  const cleaned = raw.replace(FATHOM_HEADER, "\n").replace(/\r/g, "");
  const titleMatch = cleaned.match(/^(.{3,80})\n/);
  const durationMatch = cleaned.match(/(\d+\s*mins?)/i);

  const lines: ParsedLine[] = [];
  let current: ParsedLine | null = null;

  for (const original of cleaned.split("\n")) {
    const line = original.trim();
    if (!line || line === "---") continue;
    if (/^VIEW RECORDING/i.test(line)) continue;
    if (/^https?:\/\//i.test(line)) continue;

    const roleMatch = line.match(/^(CLOSER|PROSPECTO|CLOSER|LEAD)\s*:\s*(.+)$/i);
    if (roleMatch) {
      if (current?.text) lines.push(current);
      current = {
        timestamp: null,
        speaker: roleMatch[1].toUpperCase() === "CLOSER" ? "Closer" : "Prospecto",
        text: roleMatch[2].trim(),
      };
      continue;
    }

    const stamped = line.match(
      /^(?:\[)?(\d{1,2}:\d{2}(?::\d{2})?)(?:\])?\s*[-–—]?\s*(.+)$/,
    );
    const maybeSpeaker = stamped?.[2]?.trim() || line;
    const isSpeakerLine =
      Boolean(stamped) &&
      looksLikeSpeaker(maybeSpeaker) &&
      !/[.?!]$/.test(maybeSpeaker) &&
      maybeSpeaker.split(/\s+/).length <= 14;

    if (isSpeakerLine && stamped) {
      if (current?.text) lines.push(current);
      current = {
        timestamp: stamped[1],
        speaker: maybeSpeaker.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*[-–—]\s*/, "").trim(),
        text: "",
      };
      continue;
    }

    if (!current) continue;
    current.text = current.text ? `${current.text} ${line}` : line;
  }

  if (current?.text) lines.push(current);

  const speakers = [...new Set(lines.map((l) => l.speaker).filter(Boolean))];
  return {
    title: titleMatch?.[1]?.trim() || null,
    durationHint: durationMatch?.[1] || null,
    lines: lines.filter((l) => l.text.trim().length > 0),
    speakers,
  };
}

export function formatParsedTranscript(parsed: ParsedTranscript): string {
  return parsed.lines
    .map((line) => {
      const ts = line.timestamp ? `[${line.timestamp}] ` : "";
      return `${ts}${line.speaker}: ${line.text.trim()}`;
    })
    .join("\n");
}
