import { addDays } from "@/lib/crm-prefs";

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

function utcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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

function parseIsoLike(raw: string) {
  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?\b/);
  if (iso) return iso[1];
  const dmy = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
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

  const iso = parseIsoLike(raw);
  if (iso) return iso;

  const spanish = parseSpanishDay(raw, base);
  if (spanish) return spanish;

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
    if (idx != null) return isoDay(nextWeekday(base, idx));
  }

  return null;
}
