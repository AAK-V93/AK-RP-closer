// The only place where days, weeks and months are cut (plan 4.3, risk 11).
// All cuts use local time in America/Bogota. Weeks run Monday to Sunday.
// Colombia has no daylight saving time; the offset is still read from Intl
// so a different User.timezone works the same way.

export const BOGOTA = "America/Bogota";

/** "YYYY-MM-DD" */
export type DayKey = string;

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

function localParts(at: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(at)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Minutes the zone is ahead of UTC at that instant (Bogotá: -300). */
function offsetMinutes(at: Date, timeZone: string) {
  const p = localParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar day of an instant. */
export function bogotaDay(at: Date, timeZone = BOGOTA): DayKey {
  const p = localParts(at, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** First local day of the month of an instant. */
export function bogotaMonth(at: Date, timeZone = BOGOTA): DayKey {
  return `${bogotaDay(at, timeZone).slice(0, 7)}-01`;
}

/** A @db.Date column comes back as UTC midnight: its key is the UTC date. */
export function dateOnlyKey(value: Date): DayKey {
  return value.toISOString().slice(0, 10);
}

/** DayKey → Date at UTC midnight, the shape Prisma writes into a @db.Date column. */
export function dateOnly(day: DayKey): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function addDaysKey(day: DayKey, days: number): DayKey {
  const d = dateOnly(day);
  d.setUTCDate(d.getUTCDate() + days);
  return dateOnlyKey(d);
}

export function addMonthsKey(month: DayKey, months: number): DayKey {
  const d = dateOnly(`${month.slice(0, 7)}-01`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return dateOnlyKey(d);
}

/** Instant of local midnight at the start of a local day. */
export function startOfDayInstant(day: DayKey, timeZone = BOGOTA): Date {
  const guess = new Date(`${day}T00:00:00.000Z`);
  const first = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
  // second pass covers an offset change between the guess and the answer
  return new Date(guess.getTime() - offsetMinutes(first, timeZone) * 60000);
}

/** Half-open range [start, end) of a local day as instants. */
export function dayRange(day: DayKey, timeZone = BOGOTA) {
  return { start: startOfDayInstant(day, timeZone), end: startOfDayInstant(addDaysKey(day, 1), timeZone) };
}

/** Half-open range [start, end) of the local month that starts on `month` (YYYY-MM-01). */
export function monthRange(month: DayKey, timeZone = BOGOTA) {
  const first = `${month.slice(0, 7)}-01`;
  return {
    month: first,
    start: startOfDayInstant(first, timeZone),
    end: startOfDayInstant(addMonthsKey(first, 1), timeZone),
  };
}

/** Monday of the local week of an instant. */
export function bogotaWeekStart(at: Date, timeZone = BOGOTA): DayKey {
  const day = bogotaDay(at, timeZone);
  const weekday = dateOnly(day).getUTCDay(); // 0 = Sunday
  return addDaysKey(day, -((weekday + 6) % 7));
}

export function weekRange(weekStart: DayKey, timeZone = BOGOTA) {
  return { start: startOfDayInstant(weekStart, timeZone), end: startOfDayInstant(addDaysKey(weekStart, 7), timeZone) };
}

/** Local days left in the month, today included. */
export function daysLeftInMonth(at: Date, timeZone = BOGOTA): number {
  const today = bogotaDay(at, timeZone);
  const next = addMonthsKey(bogotaMonth(at, timeZone), 1);
  return Math.round((dateOnly(next).getTime() - dateOnly(today).getTime()) / 86400000);
}

/** Whole local days between two instants (b − a). */
export function daysBetween(a: Date, b: Date, timeZone = BOGOTA): number {
  return Math.round((dateOnly(bogotaDay(b, timeZone)).getTime() - dateOnly(bogotaDay(a, timeZone)).getTime()) / 86400000);
}
