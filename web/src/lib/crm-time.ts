/** Calendar the closer actually works in. Lima is the same offset, without DST. */
export const CRM_TIMEZONE = "America/Bogota";

export function zonedDayKey(date: Date, timeZone = CRM_TIMEZONE) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
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

export function formatCrmDate(date: Date, timeZone = CRM_TIMEZONE) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-CO", {
    timeZone,
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function zonedParts(date: Date, timeZone = CRM_TIMEZONE): ZonedParts {
  const blank = { year: 0, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return blank;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** UTC instant of 00:00 on that calendar day in the closer's zone. */
export function zonedMidnight(
  year: number,
  month: number,
  day: number,
  timeZone = CRM_TIMEZONE,
) {
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    utc += Date.UTC(year, month - 1, day, 0, 0, 0) - asUtc;
  }
  return new Date(utc);
}

export function zonedMonthRange(at: Date, timeZone = CRM_TIMEZONE) {
  const { year, month } = zonedParts(at, timeZone);
  const from = zonedMidnight(year, month, 1, timeZone);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const to = zonedMidnight(nextYear, nextMonth, 1, timeZone);
  return {
    from,
    to,
    key: `${year}-${String(month).padStart(2, "0")}`,
  };
}

export function shiftZonedMonth(at: Date, delta: number, timeZone = CRM_TIMEZONE) {
  const { year, month } = zonedParts(at, timeZone);
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = index - nextYear * 12;
  return zonedMonthRange(new Date(Date.UTC(nextYear, nextMonth, 15, 17)), timeZone);
}

/** Monday 00:00 through the next Monday, in the closer's calendar. */
export function zonedWeekRange(at: Date, timeZone = CRM_TIMEZONE) {
  const key = zonedDayKey(at, timeZone);
  const [year, month, day] = key.split("-").map(Number);
  if (![year, month, day].every((n) => Number.isFinite(n))) {
    const from = zonedMidnight(1970, 1, 1, timeZone);
    return { from, to: new Date(from.getTime() + 7 * 86_400_000) };
  }
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(Date.UTC(year, month - 1, day + mondayOffset));
  const from = zonedMidnight(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    timeZone,
  );
  return { from, to: new Date(from.getTime() + 7 * 86_400_000) };
}

export function zonedDayBounds(at: Date, timeZone = CRM_TIMEZONE) {
  const { year, month, day } = zonedParts(at, timeZone);
  const from = zonedMidnight(year, month, day, timeZone);
  return {
    from,
    to: new Date(from.getTime() + 86_400_000),
    key: zonedDayKey(at, timeZone),
  };
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
