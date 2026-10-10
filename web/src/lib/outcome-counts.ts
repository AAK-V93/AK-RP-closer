import { foldLeadName } from "@/lib/crm-followups";
import { cleanReason } from "@/lib/crm-operacion";
import { zonedMonthRange, shiftZonedMonth } from "@/lib/crm-time";

/**
 * Same signals Coach already uses: a close is `CIERRE VENTA` on the call
 * (live guide / último cierre), a loss is a lead or result marked perdido, or a
 * `razon_no_cierre` when no follow-up is still agreed for that person. One person counts once. No amount is invented, and a missing
 * signal stays null («sin datos») instead of a 0.
 */
export type OutcomeCall = {
  cliente?: string | null;
  fecha?: string | null;
  estadoAgenda?: string | null;
  leadStatus?: string | null;
  seguimientoResultado?: string | null;
  razonNoCierre?: string | null;
  /**
   * The next follow-up still open on this call (proximo_seguimiento), or the lead's
   * next step date. A razón de no cierre with an agreed follow-up is an open
   * opportunity, not a loss («necesita consultarlo» + «llamar el viernes»).
   */
  fechaProximo?: string | null;
};

export type PeriodOutcomes = {
  /** People who closed in the period. Null when no call was classified. */
  won: number | null;
  /** People marked lost in the period. Null when nobody was ever marked lost. */
  lost: number | null;
  wonKeys: string[];
  lostKeys: string[];
};

const CLASSIFIED = new Set(["SHOW", "NO SHOW", "CIERRE VENTA", "ACUERDO SIN PAGO", "REPROGRAMA"]);

function foldStatus(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isWonCall(row: OutcomeCall) {
  return String(row.estadoAgenda || "").trim().toUpperCase() === "CIERRE VENTA";
}

/** Marked perdido on purpose (result or estado). Always a loss. */
function isMarkedLostCall(row: OutcomeCall) {
  if (isWonCall(row)) return false;
  const blob = `${row.seguimientoResultado || ""} ${row.estadoAgenda || ""}`;
  return /\bperdid/.test(foldStatus(blob));
}

/** Only a razón de no cierre: a loss unless the person still has an agreed follow-up. */
function isReasonOnlyLoss(row: OutcomeCall) {
  if (isWonCall(row) || isMarkedLostCall(row)) return false;
  return Boolean(cleanReason(row.razonNoCierre));
}

function hasOpenFollowup(row: OutcomeCall) {
  return /^\d{4}-\d{2}-\d{2}/.test(String(row.fechaProximo || "").trim());
}

function personLost(row: OutcomeCall) {
  return /\bperdid/.test(foldStatus(row.leadStatus));
}

function dayOf(row: OutcomeCall) {
  const day = String(row.fecha || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

function latest(days: string[]) {
  return days.filter(Boolean).sort().at(-1) || "";
}

type Person = {
  key: string;
  classified: boolean;
  wonDays: string[];
  lostDays: string[];
  reasonDays: string[];
  open: boolean;
  leadLost: boolean;
  days: string[];
};

function inPeriod(day: string, period: "mes" | "anterior" | "todo", monthKey: string, prevKey: string) {
  if (!day) return period === "todo";
  if (period === "todo") return true;
  return day.startsWith(period === "mes" ? monthKey : prevKey);
}

/**
 * Won and lost for one period. A later close beats an older loss on the same
 * person. An undated signal counts in «todo» only, so a month never becomes 0
 * just because the date is missing.
 */
export function periodOutcomes(args: {
  calls: OutcomeCall[];
  period?: "mes" | "anterior" | "todo";
  now?: Date;
}): PeriodOutcomes {
  const now = args.now || new Date();
  const period = args.period || "mes";
  const monthKey = zonedMonthRange(now).key;
  const prevKey = shiftZonedMonth(now, -1).key;
  const people = new Map<string, Person>();
  let classified = false;

  for (const row of args.calls) {
    const key = foldLeadName(String(row.cliente || ""));
    if (!key) continue;
    const person = people.get(key) || {
      key,
      classified: false,
      wonDays: [],
      lostDays: [],
      reasonDays: [],
      open: false,
      leadLost: false,
      days: [],
    };
    const day = dayOf(row);
    if (day) person.days.push(day);
    const estado = String(row.estadoAgenda || "").trim().toUpperCase();
    if (CLASSIFIED.has(estado)) {
      person.classified = true;
      classified = true;
    }
    if (isWonCall(row)) person.wonDays.push(day);
    else if (isMarkedLostCall(row)) person.lostDays.push(day);
    else if (isReasonOnlyLoss(row)) person.reasonDays.push(day);
    if (hasOpenFollowup(row)) person.open = true;
    if (personLost(row)) person.leadLost = true;
    people.set(key, person);
  }

  const won: { key: string; day: string }[] = [];
  const lost: { key: string; day: string }[] = [];
  for (const person of people.values()) {
    if (person.wonDays.length) {
      won.push({ key: person.key, day: latest(person.wonDays) });
      continue;
    }
    const lostDays = person.open ? person.lostDays : [...person.lostDays, ...person.reasonDays];
    if (lostDays.length || person.leadLost) {
      const day = lostDays.length ? latest(lostDays) : latest(person.days);
      lost.push({ key: person.key, day });
    }
  }

  const wonHere = won.filter((row) => inPeriod(row.day, period, monthKey, prevKey));
  const lostHere = lost.filter((row) => inPeriod(row.day, period, monthKey, prevKey));
  const wonUnplaced = period !== "todo" && won.length > 0 && won.every((row) => !row.day);
  const lostUnplaced = period !== "todo" && lost.length > 0 && lost.every((row) => !row.day);

  let wonCount: number | null;
  if (wonHere.length > 0) wonCount = wonHere.length;
  else if (wonUnplaced) wonCount = null;
  else if (won.length === 0 && !classified) wonCount = null;
  else wonCount = 0;

  let lostCount: number | null;
  if (lost.length === 0) lostCount = null;
  else if (lostHere.length > 0) lostCount = lostHere.length;
  else if (lostUnplaced) lostCount = null;
  else lostCount = 0;

  return {
    won: wonCount,
    lost: lostCount,
    wonKeys: wonCount == null ? [] : wonHere.map((row) => row.key),
    lostKeys: lostCount == null ? [] : lostHere.map((row) => row.key),
  };
}

/** «3 cierres este mes» / «1 cerrado · perdidos sin datos». Empty when both sides are unknown. */
export function outcomeSentences(outcomes: { won: number | null; lost: number | null } | null | undefined) {
  const won = outcomes ? outcomes.won : null;
  const lost = outcomes ? outcomes.lost : null;
  const closes = won == null ? "" : won === 1 ? "1 cierre este mes" : `${won} cierres este mes`;
  if (won == null && lost == null) return { closes: "", versus: "" };
  const wonText = won == null ? "cierres sin datos" : won === 1 ? "1 cerrado" : `${won} cerrados`;
  const lostText = lost == null ? "perdidos sin datos" : lost === 1 ? "1 perdido" : `${lost} perdidos`;
  return { closes, versus: `${wonText} · ${lostText}` };
}

/**
 * Cerró / Perdido / still open for ONE person, with the same rule the CRM tabs and
 * Coach use: a close (CIERRE VENTA) beats a loss; a loss is a stored razón de no
 * cierre, a «perdido» result, or the lead marked perdido. The status wins over any
 * follow-up data: a Perdido has no stage, no «le toca» and no next step to close.
 */
export function personOutcome(rows: readonly OutcomeCall[]): { kind: "won" | "lost" | null; reason: string } {
  let won = false;
  let marked = false;
  let byReason = false;
  let open = false;
  let reason = "";
  for (const row of rows) {
    const why = cleanReason(row.razonNoCierre);
    if (isWonCall(row)) won = true;
    else if (isMarkedLostCall(row)) marked = true;
    else if (isReasonOnlyLoss(row)) byReason = true;
    if (personLost(row)) marked = true;
    if (hasOpenFollowup(row)) open = true;
    if (why && !/^otro$/i.test(why) && !isWonCall(row)) reason = reason || why;
  }
  if (won) return { kind: "won", reason: "" };
  if (marked || (byReason && !open)) return { kind: "lost", reason };
  return { kind: null, reason: "" };
}

/** Name keys (foldLeadName) of every person the CRM shows in Perdidos, any date. */
export function lostPeopleKeys(rows: readonly OutcomeCall[]): Set<string> {
  const byKey = new Map<string, OutcomeCall[]>();
  for (const row of rows) {
    const key = foldLeadName(String(row.cliente || ""));
    if (!key) continue;
    const list = byKey.get(key) || [];
    list.push(row);
    byKey.set(key, list);
  }
  const out = new Set<string>();
  for (const [key, list] of byKey) if (personOutcome(list).kind === "lost") out.add(key);
  return out;
}
