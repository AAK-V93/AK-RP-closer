/** Calendar the closer actually works in. Lima is the same offset, without DST. */
export const CRM_TIMEZONE = "America/Bogota";

export function zonedDayKey(date: Date, timeZone = CRM_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

/** Signed whole days from `today` (YYYY-MM-DD) to `dueDay`. Negative means overdue. */
export function calendarDaysBetween(dueDay: string, today: string) {
  const [y1, m1, d1] = dueDay.split("-").map(Number);
  const [y2, m2, d2] = today.split("-").map(Number);
  if (![y1, m1, d1, y2, m2, d2].every((n) => Number.isFinite(n))) return 0;
  return Math.round(
    (Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86_400_000,
  );
}
