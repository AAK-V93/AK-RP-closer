import { realClientName } from "@/lib/crm-noise";
import { zonedDayKey, zonedMonthRange, zonedWeekRange } from "@/lib/crm-time";
import { personLikeTitle, readableTitle } from "@/lib/plain-labels";

/** Default history length. A week longer than this stays behind «Ver todas». */
export const HISTORY_CAP = 10;

export type HistoryScope = "semana" | "mes" | "todas";

function dayKeyOf(value?: string | null) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return zonedDayKey(date);
  }
  return "";
}

/**
 * The name the closer recognizes. A stored lead beats «Llamada del 28 sep, 11:04».
 * With no name, the date title stays — it is not replaced with a guess.
 */
export function pendingHeading(row: { leadName?: string | null; title?: string | null }) {
  const lead = realClientName(row.leadName);
  if (lead && !/^llamada del\b/i.test(lead)) return readableTitle(lead);
  const fromTitle = personLikeTitle(row.title);
  if (fromTitle) return readableTitle(fromTitle);
  return readableTitle(row.title);
}

/**
 * This week, capped at 10. The month filter shows that month.
 * An empty week falls back to the 10 most recent so the page is not blank.
 */
export function sliceCallHistory<T extends { date?: string | null }>(
  rows: T[],
  scope: HistoryScope,
  now = new Date(),
): { visible: T[]; hidden: number; fallback: boolean } {
  const sorted = [...rows].sort((a, b) => dayKeyOf(b.date).localeCompare(dayKeyOf(a.date)));
  if (scope === "todas") return { visible: sorted, hidden: 0, fallback: false };
  const range = scope === "mes" ? zonedMonthRange(now) : zonedWeekRange(now);
  const from = zonedDayKey(range.from);
  const to = zonedDayKey(range.to);
  const inside = sorted.filter((row) => {
    const day = dayKeyOf(row.date);
    return Boolean(day) && day >= from && day < to;
  });
  if (scope === "mes") return { visible: inside, hidden: 0, fallback: false };
  if (inside.length === 0) {
    const visible = sorted.slice(0, HISTORY_CAP);
    return {
      visible,
      hidden: Math.max(0, sorted.length - visible.length),
      fallback: sorted.length > 0,
    };
  }
  const visible = inside.slice(0, HISTORY_CAP);
  return { visible, hidden: inside.length - visible.length, fallback: false };
}
