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

/** `2026-10-07 15:00` in the closer's zone. A stamp already written that way is kept. */
export function formatCrmStamp(value: Date | string | null | undefined, timeZone = CRM_TIMEZONE) {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 16).replace("T", " ");
    }
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return "";
    return formatCrmStamp(date, timeZone);
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const parts = zonedParts(value, timeZone);
  const pad = (part: number) => String(part).padStart(2, "0");
  const hour = parts.hour === 24 ? 0 : parts.hour;
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(hour)}:${pad(parts.minute)}`;
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

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function clockLabel(hour: number, minute: number) {
  const suffix = hour >= 12 ? "pm" : "am";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** «5 oct, 8:47 pm» in Bogotá. A bare calendar day stays empty. */
export function formatBogotaSpoken(value: Date | string | null | undefined, now = new Date()) {
  if (value == null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date);
  if (!parts.year) return "";
  const month = MONTHS_SHORT[parts.month - 1] || "";
  const year = parts.year === zonedParts(now).year ? "" : ` ${parts.year}`;
  return `${parts.day} ${month}${year}, ${clockLabel(parts.hour, parts.minute)}`;
}

/** «9 de mayo de 2026» from `YYYY-MM-DD`, without shifting the day through UTC. */
export function formatIsoDayLong(value: string | null | undefined) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const month = MONTHS_LONG[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (!month || !day) return "";
  return `${day} de ${month} de ${match[1]}`;
}

/**
 * «30/9/2026» → «30 sep» in Bogotá (day/month, the closer's calendar).
 * Display only. A stored next follow-up is not rewritten here — Katherine Rodríguez's
 * 2027-05-18 05:00 is real data for Kali and must stay in the database.
 */
export function humanizeSlashDates(value: string, now = new Date()) {
  const yearNow = zonedParts(now).year;
  return String(value || "").replace(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/g, (full, dayRaw, monthRaw, yearRaw) => {
    const day = Number(dayRaw);
    const month = Number(monthRaw);
    let year = Number(yearRaw);
    if (year < 100) year += 2000;
    if (!day || !month || month > 12 || day > 31) return full;
    const short = MONTHS_SHORT[month - 1];
    if (!short) return full;
    return year === yearNow ? `${day} ${short}` : `${day} ${short} ${year}`;
  });
}

/** «3 oct» or «3 oct 2025» in Bogotá. */
export function formatBogotaDay(value: Date | string | null | undefined, now = new Date()) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [year, month, day] = value.trim().split("-").map(Number);
    const short = MONTHS_SHORT[month - 1] || "";
    if (!short || !day) return "";
    return year === zonedParts(now).year ? `${day} ${short}` : `${day} ${short} ${year}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date);
  const short = MONTHS_SHORT[parts.month - 1] || "";
  if (!short || !parts.day) return "";
  return parts.year === zonedParts(now).year
    ? `${parts.day} ${short}`
    : `${parts.day} ${short} ${parts.year}`;
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
