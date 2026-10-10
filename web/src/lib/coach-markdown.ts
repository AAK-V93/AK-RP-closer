export type CoachSpan = { text: string; bold: boolean };

/** Coach replies sometimes arrive with raw **asterisks**. Render the emphasis and drop the marks. */
export function coachBlocks(source: string): CoachSpan[][] {
  return String(source || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => spansOf(line));
}

function spansOf(line: string): CoachSpan[] {
  const spans: CoachSpan[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    push(spans, line.slice(last, match.index), false);
    push(spans, match[1], true);
    last = match.index + match[0].length;
  }
  push(spans, line.slice(last), false);
  return spans;
}

function push(spans: CoachSpan[], raw: string, bold: boolean) {
  const text = raw.replace(/\*+/g, "");
  if (!text) return;
  spans.push({ text, bold });
}
