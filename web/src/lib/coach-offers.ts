import { foldLeadName } from "@/lib/crm-followups";
import { cleanReason } from "@/lib/crm-operacion";
import { shownOffer } from "@/lib/inicio-view";
import { outcomeSentences, periodOutcomes, type OutcomeCall } from "@/lib/outcome-counts";
import { countPhrase } from "@/lib/plain-labels";
import { zonedMonthRange } from "@/lib/crm-time";

/**
 * Coach numbers use the same close and loss signals as Inicio.
 * A close is CIERRE VENTA. A loss is razon_no_cierre or a lead marked perdido.
 * «Este mes» and «Histórico» stay labeled apart. Histórico is llamadas con
 * persona, not the practice archive on Ofertas. A missing signal stays empty,
 * never a made-up 0.
 */
export type CoachEvidence = {
  id?: string;
  cliente?: string | null;
  fecha?: string | null;
  estadoAgenda?: string | null;
  leadStatus?: string | null;
  seguimientoResultado?: string | null;
  razonNoCierre?: string | null;
  fechaProximo?: string | null;
  oferta?: string | null;
  producto?: string | null;
  interna?: boolean;
};

export type CoachObjection = {
  text: string;
  /** People, not repeated calls. */
  people: number;
  periodLabel: "Este mes" | "Histórico";
  offerName: string;
};

export type CoachOfferCard = {
  offerName: string;
  monthVersus: string;
  monthCalls: string;
  historyVersus: string;
  historyCalls: string;
};

export type CoachBoard = {
  /** Same «1 cerrado · 2 perdidos» sentence Inicio shows for this month. */
  monthVersus: string;
  monthCalls: string;
  offers: CoachOfferCard[];
  objection: CoachObjection | null;
};

function offerOf(row: CoachEvidence) {
  return shownOffer(row.oferta) || shownOffer(row.producto);
}

function realCall(row: CoachEvidence) {
  return !row.interna && !String(row.id || "").startsWith("lead:");
}

function dayOf(row: CoachEvidence) {
  const day = String(row.fecha || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

function toOutcome(row: CoachEvidence): OutcomeCall {
  return {
    cliente: row.cliente,
    fecha: row.fecha,
    estadoAgenda: row.estadoAgenda,
    leadStatus: row.leadStatus,
    seguimientoResultado: row.seguimientoResultado,
    razonNoCierre: row.razonNoCierre,
    fechaProximo: row.fechaProximo,
  };
}

function callsInMonth(rows: CoachEvidence[], monthKey: string) {
  return rows.filter((row) => realCall(row) && dayOf(row).startsWith(monthKey)).length;
}

function callsAll(rows: CoachEvidence[]) {
  return rows.filter((row) => realCall(row) && (dayOf(row) || row.cliente)).length;
}

/**
 * Calls with no offer, plus a lead that was never tied to one.
 * A person who already has an offer stays on that card, so a loss is not counted twice.
 */
function unassignedRows(rows: CoachEvidence[]) {
  const peopleWithOffer = new Set<string>();
  for (const row of rows) {
    if (!offerOf(row)) continue;
    const person = foldLeadName(String(row.cliente || ""));
    if (person) peopleWithOffer.add(person);
  }
  return rows.filter((row) => {
    if (offerOf(row)) return false;
    if (realCall(row)) return true;
    const person = foldLeadName(String(row.cliente || ""));
    return Boolean(person) && !peopleWithOffer.has(person);
  });
}

/** Últimas prácticas. The internal save line is not something the closer rehearses. */
export function shownPracticeOutcome(value: string | null | undefined) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/qc parcial|no perderla|re-auditar/i.test(text)) return "";
  return text;
}

function callPhrase(count: number, suffix: string) {
  if (count <= 0) return "";
  const phrase = countPhrase(count, "llamada", "llamadas");
  return suffix ? `${phrase} ${suffix}` : phrase;
}

type ReasonHit = { text: string; day: string; offer: string };

function topObjection(rows: CoachEvidence[], monthKey: string): CoachObjection | null {
  const byPerson = new Map<string, ReasonHit>();
  for (const row of rows) {
    if (row.interna) continue;
    const text = cleanReason(row.razonNoCierre);
    if (!text || text === "Otro") continue;
    const person = foldLeadName(String(row.cliente || ""));
    if (!person) continue;
    const day = dayOf(row);
    const prev = byPerson.get(person);
    const synthetic = String(row.id || "").startsWith("lead:");
    if (prev && synthetic) continue;
    if (prev && prev.day && day && day < prev.day) continue;
    if (prev && prev.day && !day) continue;
    byPerson.set(person, { text, day, offer: offerOf(row) });
  }
  const pick = (period: "mes" | "todo") => {
    const pool = [...byPerson.values()].filter((row) =>
      period === "todo" ? true : row.day.startsWith(monthKey),
    );
    const counts = new Map<string, { text: string; people: number; offers: Set<string> }>();
    for (const row of pool) {
      const key = row.text.toLocaleLowerCase("es");
      const cur = counts.get(key) || { text: row.text, people: 0, offers: new Set<string>() };
      cur.people += 1;
      if (row.offer) cur.offers.add(row.offer);
      counts.set(key, cur);
    }
    const best = [...counts.values()].sort((a, b) => b.people - a.people || a.text.localeCompare(b.text, "es"))[0];
    if (!best) return null;
    const offerName = best.offers.size === 1 ? [...best.offers][0] : "";
    return {
      text: best.text,
      people: best.people,
      periodLabel: period === "mes" ? ("Este mes" as const) : ("Histórico" as const),
      offerName,
    };
  };
  return pick("mes") || pick("todo");
}

function cardFor(rows: CoachEvidence[], offerName: string, now: Date): CoachOfferCard | null {
  const monthKey = zonedMonthRange(now).key;
  const month = periodOutcomes({ calls: rows.map(toOutcome), period: "mes", now });
  const all = periodOutcomes({ calls: rows.map(toOutcome), period: "todo", now });
  const monthCalls = callsInMonth(rows, monthKey);
  const historyCalls = callsAll(rows);
  const monthVersus = outcomeSentences(month).versus;
  const historyVersus = outcomeSentences(all).versus;
  const same =
    month.won === all.won &&
    month.lost === all.lost &&
    monthCalls === historyCalls;
  if (!monthVersus && !historyVersus && monthCalls === 0 && historyCalls === 0) return null;
  return {
    offerName,
    monthVersus,
    monthCalls: callPhrase(monthCalls, "este mes"),
    historyVersus: same ? "" : historyVersus,
    historyCalls: same ? "" : callPhrase(historyCalls, "con persona"),
  };
}

export function buildCoachOffers(args: {
  calls: CoachEvidence[];
  offerNames?: string[];
  now?: Date;
}): CoachBoard {
  const now = args.now || new Date();
  const monthKey = zonedMonthRange(now).key;
  const visible = args.calls.filter((row) => !row.interna);
  const month = periodOutcomes({ calls: visible.map(toOutcome), period: "mes", now });
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const clean = shownOffer(name);
    const key = clean.toLocaleLowerCase("es");
    if (!clean || seen.has(key)) return;
    seen.add(key);
    names.push(clean);
  };
  for (const name of args.offerNames || []) push(name);
  for (const row of visible) push(offerOf(row));

  const offers = names
    .map((name) =>
      cardFor(
        visible.filter((row) => offerOf(row).toLocaleLowerCase("es") === name.toLocaleLowerCase("es")),
        name,
        now,
      ),
    )
    .filter((row): row is CoachOfferCard => Boolean(row));
  const loose = cardFor(unassignedRows(visible), "Sin oferta", now);
  if (loose) offers.push(loose);

  return {
    monthVersus: outcomeSentences(month).versus,
    monthCalls: callPhrase(callsInMonth(visible, monthKey), "este mes"),
    offers,
    objection: topObjection(visible, monthKey),
  };
}
