/** Lead.oneLine and Call.oneLine are VarChar(140): trim on write, never cut mid-word if avoidable. */
export const ONE_LINE_MAX = 140;

export function toOneLine(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= ONE_LINE_MAX) return text;
  const cut = text.slice(0, ONE_LINE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 80 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}
