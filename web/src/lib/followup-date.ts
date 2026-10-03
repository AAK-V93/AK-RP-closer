import { addDays } from "@/lib/crm-prefs";
import { formatCrmDate, zonedDayKey } from "@/lib/crm-time";

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

const MONTHS: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Noon UTC of the calendar day in America/Bogota, so "hoy" does not flip at 19:00. */
function utcDay(date: Date) {
  const key = zonedDayKey(date);
  const [year, month, day] = key.split("-").map(Number);
  if (![year, month, day].every((n) => Number.isFinite(n) && n > 0)) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  }
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextWeekday(from: Date, weekday: number) {
  const day = from.getUTCDay();
  let delta = (weekday - day + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(from, delta);
}

export function quickFollowupIso(
  choice: "hoy" | "manana" | "semana",
  from = new Date(),
) {
  const base = utcDay(from);
  if (choice === "hoy") return isoDay(base);
  if (choice === "manana") return isoDay(addDays(base, 1));
  const friday = 5;
  const day = base.getUTCDay();
  if (day === friday) return isoDay(base);
  if (day === 6 || day === 0) return isoDay(nextWeekday(base, friday));
  return isoDay(nextWeekday(base, friday));
}

function withoutTranscriptStamps(raw: string) {
  return raw
    .replace(/\[[^\]]*?\d{1,2}:\d{2}[^\]]*?\]/g, " ")
    .replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, " ");
}

/** A clock the closer actually said. Transcript offsets like [00:47:12] are not a meeting time. */
export function spokenFollowupClock(raw: string) {
  const folded = fold(withoutTranscriptStamps(raw));
  const ampm = folded.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\b/);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = ampm[2] || "00";
    const pm = /p/.test(ampm[3]);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) return `${String(hour).padStart(2, "0")}:${minute}`;
  }
  const alas = folded.match(/\ba las\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (alas) {
    const hour = Number(alas[1]);
    if (hour >= 0 && hour <= 23) return `${String(hour).padStart(2, "0")}:${alas[2] || "00"}`;
  }
  const horas = folded.match(/\b(\d{1,2})(?::(\d{2}))?\s*h(?:oras|s)\b/);
  if (horas) {
    const hour = Number(horas[1]);
    if (hour >= 0 && hour <= 23) return `${String(hour).padStart(2, "0")}:${horas[2] || "00"}`;
  }
  return null;
}

function clockFromText(raw: string) {
  return spokenFollowupClock(raw);
}

function withClock(day: string | null, raw: string) {
  if (!day) return null;
  const clock = clockFromText(raw);
  return clock ? `${day} ${clock}` : day;
}

function parseIsoLike(raw: string) {
  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?\b/);
  if (iso) return iso[2] ? `${iso[1]} ${iso[2]}` : iso[1];
  const dmy = raw.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${month}-${day}`;
  }
  return null;
}

function parseSpanishDay(raw: string, callAt: Date) {
  const folded = fold(raw);
  const named = folded.match(
    /\b(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/,
  );
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2]];
    if (!Number.isFinite(day) || month == null) return null;
    let year = callAt.getUTCFullYear();
    let date = new Date(Date.UTC(year, month, day));
    if (date.getTime() < utcDay(callAt).getTime() - 12 * 3600 * 1000) {
      date = new Date(Date.UTC(year + 1, month, day));
    }
    return isoDay(date);
  }
  return null;
}

/** Best YYYY-MM-DD found in transcript/metadata relative to the call day. */
export function inferFollowupDate(text: string, callAt?: Date | string | null) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const base =
    callAt instanceof Date
      ? utcDay(callAt)
      : callAt
        ? utcDay(new Date(callAt))
        : utcDay(new Date());
  if (Number.isNaN(base.getTime())) return null;

  const appointed =
    dayMonthWithClock(raw, base) || weekdayAndDay(raw, base) || weekdayWithClock(raw, base);
  if (appointed) return appointed;

  const iso = parseIsoLike(raw);
  if (iso) return iso;

  const spanish = parseSpanishDay(raw, base);
  if (spanish) return withClock(spanish, raw);

  const folded = fold(raw);
  if (/\bhoy\b/.test(folded)) return isoDay(base);
  if (/\bpasado\s+manana\b/.test(folded)) return isoDay(addDays(base, 2));
  if (/\bmanana\b/.test(folded)) return isoDay(addDays(base, 1));

  const inDays = folded.match(/\ben\s+(\d{1,2})\s+dias?\b/);
  if (inDays) {
    const n = Number(inDays[1]);
    if (n > 0 && n < 60) return isoDay(addDays(base, n));
  }

  const weekday = folded.match(
    /\b(?:el|este|para\s+el)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/,
  );
  if (weekday) {
    const idx = WEEKDAYS[weekday[1]];
    if (idx != null) return withClock(isoDay(nextWeekday(base, idx)), raw);
  }

  return null;
}

const MONTH_WORD =
  "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic";

function monthIndex(word: string) {
  const full: Record<string, number> = {
    ene: 0,
    feb: 1,
    mar: 2,
    abr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    ago: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dic: 11,
  };
  return MONTHS[word] ?? full[word] ?? null;
}

function dayMonthWithClock(raw: string, base: Date) {
  const folded = fold(raw);
  const re = new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${MONTH_WORD})\\b`, "g");
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(folded))) {
    const window = folded.slice(Math.max(0, hit.index - 24), hit.index + hit[0].length + 24);
    const clock = clockFromText(window);
    if (!clock) continue;
    const day = Number(hit[1]);
    const month = monthIndex(hit[2]);
    if (!Number.isFinite(day) || month == null || day < 1 || day > 31) continue;
    let year = base.getUTCFullYear();
    let date = new Date(Date.UTC(year, month, day));
    if (date.getTime() < base.getTime() - 12 * 3600 * 1000) {
      year += 1;
      date = new Date(Date.UTC(year, month, day));
    }
    return `${isoDay(date)} ${clock}`;
  }
  return null;
}

/** «viernes 9» / «miércoles 7» is that day-of-month when it falls on the weekday, not merely the next weekday. */
function weekdayAndDay(raw: string, base: Date) {
  const folded = fold(raw);
  const re =
    /\b(?:el|este|para\s+el)?\s*(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+(\d{1,2})\b/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(folded))) {
    const idx = WEEKDAYS[hit[1]];
    const dayNum = Number(hit[2]);
    if (idx == null || dayNum < 1 || dayNum > 31) continue;
    const date = upcomingWeekdayDate(base, idx, dayNum);
    if (!date) continue;
    return withClock(isoDay(date), raw);
  }
  return null;
}

function upcomingWeekdayDate(base: Date, weekday: number, dayNum: number) {
  let year = base.getUTCFullYear();
  let month = base.getUTCMonth();
  for (let i = 0; i < 14; i += 1) {
    const date = new Date(Date.UTC(year, month, dayNum, 12, 0, 0));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month &&
      date.getUTCDate() === dayNum &&
      date.getUTCDay() === weekday &&
      date.getTime() >= base.getTime() - 36 * 3600 * 1000
    ) {
      return date;
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return null;
}

function weekdayWithClock(raw: string, base: Date) {
  const folded = fold(raw);
  const re =
    /\b(?:el|este|para\s+el)?\s*(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(folded))) {
    const window = folded.slice(Math.max(0, hit.index - 12), hit.index + hit[0].length + 24);
    const clock = clockFromText(window);
    if (!clock) continue;
    const idx = WEEKDAYS[hit[1]];
    if (idx == null) continue;
    return `${isoDay(nextWeekday(base, idx))} ${clock}`;
  }
  return null;
}

/** A calendar day written in the transcript, used as the call date when the file was pasted. */
export function inferCallDate(text: string, now = new Date()): Date | null {
  const raw = String(text || "");
  const dmy = raw.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
  if (dmy) {
    const date = new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), 12, 0, 0));
    if (!Number.isNaN(date.getTime()) && date.getTime() <= now.getTime() + 36 * 3_600_000) return date;
  }
  const named = fold(raw).match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(20\d{2}))?\b/,
  );
  if (!named) return null;
  const day = Number(named[1]);
  const month = MONTHS[named[2]];
  if (month == null) return null;
  const zonedYear = Number(zonedDayKey(now).slice(0, 4));
  const year = named[3] ? Number(named[3]) : zonedYear || now.getUTCFullYear();
  let date = new Date(Date.UTC(year, month, day, 12, 0, 0));
  if (date.getTime() > now.getTime() + 36 * 3_600_000) {
    date = new Date(Date.UTC(year - 1, month, day, 12, 0, 0));
  }
  if (Number.isNaN(date.getTime()) || date.getTime() > now.getTime() + 36 * 3_600_000) return null;
  return date;
}

export function inferLeadLabel(text: string) {
  const labeled = String(text || "").match(/\b(?:lead|prospecto|cliente)\s*:\s*([^\n,.]{2,80})/i);
  if (!labeled) return "";
  const words = labeled[1]
    .replace(/\(.*?\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => /^[\p{L}][\p{L}'’.-]*$/u.test(word));
  if (words.length < 1 || words.length > 4) return "";
  return words.join(" ");
}

export function isPasteHeading(title: string) {
  const value = title.trim();
  if (/^(pegado|llamada)\b/i.test(value)) return true;
  return /\s·\s\d{1,2}\/\d{1,2}\/\d{4}$/.test(value);
}

/** Lead and call day. The day comes from the transcript, or from the paste moment in Bogotá. */
export function pastedCallTitle(text: string, pastedAt = new Date(), leadOverride = "") {
  const callAt = inferCallDate(text, pastedAt);
  const day = formatCrmDate(callAt || pastedAt);
  const lead = (leadOverride || inferLeadLabel(text)).trim();
  if (lead && callAt) return `${lead} · ${day}`;
  if (lead) return `${lead} · Pegado ${day}`;
  if (callAt) return `Llamada ${day}`;
  return `Pegado ${day}`;
}
