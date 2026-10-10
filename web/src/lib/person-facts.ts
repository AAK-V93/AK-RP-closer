import { agreementSummary, agreementFromField, cleanNote, type AgreementSummary } from "@/lib/agreement-summary";
import { calendarDaysBetween, zonedDayKey } from "@/lib/crm-time";
import { followupStage, type FollowupStage } from "@/lib/followup-stage";
import { closerFacingNote, shownOffer, type OfferScript } from "@/lib/inicio-view";
import { personMessages } from "@/lib/person-messages";
import { callNamesSomeoneElse, samePersonName } from "@/lib/lead-match";
import { personOutcome, type OutcomeCall } from "@/lib/outcome-counts";
import { cleanReason } from "@/lib/crm-operacion";
import { dealMoney, saleCall } from "@/lib/deal-money";
import { moneyLabel } from "@/lib/crm-operacion";
import { plainStatus } from "@/lib/plain-labels";

/**
 * Everything the ficha and the chat know about one person, from rows that are
 * already stored. Pure: the route loads, this reads. Nothing is invented; a
 * missing field says so.
 */
export type FactLead = {
  id: string;
  name: string;
  offerName?: string | null;
  status?: string | null;
  telefono?: string | null;
  nextStep?: string | null;
  nextStepAt?: Date | string | null;
  objections?: string | null;
  amountTalked?: string | null;
  amountPaid?: string | null;
  decider?: string | null;
  razonNoCierre?: string | null;
  lastSummary?: string | null;
};

export type FactCall = {
  id: string;
  leadName?: string | null;
  offerName?: string | null;
  estadoAgenda?: string | null;
  recordedAt?: Date | string | null;
  createdAt?: Date | string | null;
  summary?: string | null;
  filingJson?: unknown;
  ventaTotal?: number | null;
  cashCollected?: number | null;
  saldoPendiente?: number | null;
  modoPago?: string | null;
};

export type FactAlert = {
  id: string;
  type?: string | null;
  dueAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  resultado?: string | null;
  createdAt?: Date | string | null;
  mensajeSugerido?: string | null;
  enJuego?: number | null;
};

type Filing = {
  lead_id?: string;
  cliente_real?: string;
  producto?: string;
  estado_agenda?: string;
  acuerdo_seguimiento?: string;
  notas_crm?: string;
  tipo_seguimiento?: string;
  proximo_seguimiento?: string;
  razon_no_cierre?: string;
  modo_pago?: string;
  venta_total?: number | null;
  cash_collected?: number | null;
  saldo_pendiente?: number | null;
  telefono?: string;
  seguimiento_resultado?: string;
  seguimiento_intentos?: number | null;
  seguimiento_contactos?: number | null;
};

export type HistoryItem = { day: string; date: string; label: string; kind: "call" | "followup" };

export type PersonFacts = {
  leadId: string;
  name: string;
  firstName: string;
  offer: string;
  phone: string;
  /** «En seguimiento», «Cerró», «Perdido». */
  status: string;
  ended: boolean;
  summary: AgreementSummary;
  stage: FollowupStage | null;
  /** Next follow-up day (YYYY-MM-DD) or empty. */
  nextDay: string;
  lastCallDay: string;
  lastContact: { day: string; kind: "call" | "followup"; resultado: string } | null;
  details: {
    decisor: string;
    objeciones: string;
    presupuesto: string;
    formaPago: string;
    pagado: string;
    saldo: string;
    acuerdos: string[];
    razonNoCierre: string;
    notas: string[];
  };
  history: HistoryItem[];
  messages: string[];
  openAlertId: string;
  /** Newest CRM call of the person (to save a phone when there is no lead yet). */
  callId: string;
};

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function filingOf(raw: unknown): Filing {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Filing) : {};
}

function dayOf(value: Date | string | null | undefined) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? zonedDayKey(at) : "";
}

/** «15 sep», «15 sep 2025» when it is another year. */
export function shortDate(day: string, today: string) {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return "";
  const base = `${date} ${MONTHS_SHORT[month - 1]}`;
  return today && String(year) !== today.slice(0, 4) ? `${base} ${year}` : base;
}

export function firstNameOf(name: string) {
  return name.trim().split(/\s+/)[0] || name.trim();
}

function callDay(call: FactCall) {
  return dayOf(call.recordedAt || call.createdAt || null);
}

function callNameOf(call: FactCall) {
  const filing = filingOf(call.filingJson);
  return String(filing.cliente_real || call.leadName || "").trim();
}

/** Moved to lead-match so the CRM rows and the ficha share one guard. */
export { callNamesSomeoneElse } from "@/lib/lead-match";

/** Calls of this person: stamped with the lead id, or the same full name. */
export function callsForPerson(lead: { id: string; name: string }, calls: readonly FactCall[]) {
  return calls.filter((call) => {
    const filing = filingOf(call.filingJson);
    if (filing.lead_id) {
      if (filing.lead_id === lead.id) return !callNamesSomeoneElse(lead.name, callNameOf(call));
      // A person who only exists on calls («name:…») keeps a call that an old filing stamped on someone else.
      return lead.id.startsWith("name:") && samePersonName(lead.name, callNameOf(call));
    }
    const name = String(call.leadName || filing.cliente_real || "").trim();
    return Boolean(name) && samePersonName(lead.name, name);
  });
}

/** The rows the CRM tabs use to say Cerró / Perdido, for this person's calls. */
function outcomeRows(
  lead: Pick<FactLead, "status" | "razonNoCierre"> | null,
  calls: readonly FactCall[],
  openDays: readonly string[] = [],
): OutcomeCall[] {
  const rows: OutcomeCall[] = calls.map((call) => {
    const filing = filingOf(call.filingJson);
    return {
      cliente: "x",
      fecha: callDay(call),
      estadoAgenda: String(filing.estado_agenda || call.estadoAgenda || ""),
      leadStatus: lead?.status || "",
      seguimientoResultado: String(filing.seguimiento_resultado || ""),
      razonNoCierre: cleanReason(String(filing.razon_no_cierre || "") || String(lead?.razonNoCierre || "")),
      fechaProximo: String(filing.proximo_seguimiento || "").trim().slice(0, 10),
    };
  });
  for (const day of openDays) rows.push({ cliente: "x", leadStatus: lead?.status || "", fechaProximo: day });
  if (!rows.length && lead) rows.push({ cliente: "x", leadStatus: lead.status || "", razonNoCierre: cleanReason(lead.razonNoCierre) });
  return rows;
}

/**
 * Cerró / Perdido / En seguimiento with the SAME rule as the CRM tabs, so a person in
 * Perdidos is Perdido in the ficha and the chat too. The status wins over follow-ups.
 */
export function personStatus(
  lead: Pick<FactLead, "status" | "razonNoCierre"> | null,
  calls: readonly FactCall[],
  alerts: readonly Pick<FactAlert, "resolvedAt" | "dueAt">[] = [],
) {
  const raw = String(lead?.status || "").trim().toLowerCase();
  const openDays = alerts.filter((row) => !row.resolvedAt).map((row) => dayOf(row.dueAt || null)).filter(Boolean);
  const outcome = personOutcome(outcomeRows(lead, calls, openDays));
  if (outcome.kind === "won" || /cerrad|ganad|cliente/.test(raw)) {
    return { status: "Cerró", ended: true, lost: false, reason: "" };
  }
  if (outcome.kind === "lost") return { status: "Perdido", ended: true, lost: true, reason: outcome.reason };
  return { status: "En seguimiento", ended: false, lost: false, reason: "" };
}

function statusOf(
  lead: Pick<FactLead, "status" | "razonNoCierre"> | null,
  calls: readonly FactCall[],
  alerts: readonly Pick<FactAlert, "resolvedAt" | "dueAt">[] = [],
) {
  return personStatus(lead, calls, alerts);
}

const RAZON_PHRASE: Record<string, string> = {
  "precio / no tiene dinero": "el precio: dijo que no tenía el dinero",
  "no era el momento": "que no era el momento",
  "necesita consultarlo con alguien": "que necesitaba consultarlo con alguien",
  "no confía / necesita más información": "que no confiaba todavía y quería más información",
  "ya compró con otra persona": "que ya compró con otra persona",
  "no asistió / no se presentó": "que no se presentó a la llamada",
};

/** «el precio: dijo que no tenía el dinero». Free text stays as written. */
export function objectionPhrase(value: string) {
  const text = value.trim();
  if (!text || /^otro$/i.test(text)) return "";
  return RAZON_PHRASE[text.toLowerCase()] || text.replace(/\.$/, "");
}

function money(value: number | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? moneyLabel(n, "USD") : "";
}


function words(value: string) {
  return new Set(
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3),
  );
}

/** Drops near-copies («Llamar el viernes para cerrar tras hablarlo con la socia» after the longer one). */
function uniqNear(values: string[]) {
  const kept: { text: string; words: Set<string> }[] = [];
  for (const value of uniq(values)) {
    const mine = words(value);
    const twin = kept.some((row) => {
      const shared = [...mine].filter((word) => row.words.has(word)).length;
      const smaller = Math.min(mine.size, row.words.size) || 1;
      return shared / smaller >= 0.6;
    });
    if (!twin) kept.push({ text: value, words: mine });
  }
  return kept.map((row) => row.text);
}

function uniq(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const RESULT_LABEL: Record<string, string> = {
  hecho: "Hecho",
  no_contesto: "No contestó",
  reprogramado: "Reprogramado",
  mostro: "Asistió",
  no_mostro: "No asistió",
  perdido: "Perdido",
  cerro: "Cerró",
  pago: "Pagó",
};

/**
 * The «Seguimiento N de 10» stage of one person, the same in the ficha and the CRM sheets.
 * Null for cerrados and perdidos.
 */
export function personStage(args: {
  lead: Pick<FactLead, "status" | "razonNoCierre"> | null;
  calls: readonly FactCall[];
  alerts?: readonly Pick<FactAlert, "resolvedAt" | "resultado" | "dueAt">[];
}): FollowupStage | null {
  const calls = [...args.calls].sort((a, b) => callDay(b).localeCompare(callDay(a)));
  const last = calls[0];
  const lastFiling = filingOf(last?.filingJson);
  if (statusOf(args.lead, calls, (args.alerts || []) as FactAlert[]).ended) return null;
  return followupStage({
    status: args.lead?.status,
    callDates: calls.map((call) => call.recordedAt || call.createdAt || null),
    attempts: (args.alerts || []).map((row) => ({ at: row.resolvedAt, resultado: row.resultado })),
    lastCallAttempts: last ? { contactos: lastFiling.seguimiento_contactos, resultado: lastFiling.seguimiento_resultado } : null,
  });
}

/**
 * Stage label per lead id (and «call:<id>» for calls with no lead) for the CRM sheets.
 * Empty string = no stage (cerrado / perdido). Pure: the caller loads the rows read-only.
 */
export function stageMapByLead(args: {
  leads: readonly Pick<FactLead, "id" | "name" | "status">[];
  calls: readonly FactCall[];
  alerts: readonly (Pick<FactAlert, "resolvedAt" | "resultado" | "dueAt"> & { leadId: string })[];
}): Record<string, FollowupStage | null> {
  const out: Record<string, FollowupStage | null> = {};
  const byLead = new Map<string, (typeof args.alerts)[number][]>();
  for (const alert of args.alerts) {
    const list = byLead.get(alert.leadId) || [];
    list.push(alert);
    byLead.set(alert.leadId, list);
  }
  // Stamped calls by lead id; only unstamped calls need the (slower) name match.
  const stamped = new Map<string, FactCall[]>();
  const loose: FactCall[] = [];
  for (const call of args.calls) {
    const leadId = String(filingOf(call.filingJson).lead_id || "");
    const owner = leadId ? args.leads.find((lead) => lead.id === leadId) : undefined;
    if (owner && callNamesSomeoneElse(owner.name, callNameOf(call))) continue;
    if (!leadId) {
      loose.push(call);
      continue;
    }
    const list = stamped.get(leadId) || [];
    list.push(call);
    stamped.set(leadId, list);
  }
  const claimed = new Set<string>();
  for (const lead of args.leads) {
    const calls = [...(stamped.get(lead.id) || []), ...callsForPerson(lead, loose)];
    for (const call of calls) claimed.add(call.id);
    out[lead.id] = personStage({ lead, calls, alerts: byLead.get(lead.id) || [] });
  }
  for (const call of args.calls) {
    if (claimed.has(call.id)) continue;
    out[`call:${call.id}`] = personStage({ lead: null, calls: [call] });
  }
  return out;
}

export function stagesByLead(args: Parameters<typeof stageMapByLead>[0]): Record<string, string> {
  return Object.fromEntries(Object.entries(stageMapByLead(args)).map(([key, stage]) => [key, stage?.label || ""]));
}

/** Attempts since the last call per lead id / «call:<id>»; null = no stage (cerrado / perdido). For the CRM stage filter. */
export function stageCountsByLead(args: Parameters<typeof stageMapByLead>[0]): Record<string, number | null> {
  return Object.fromEntries(Object.entries(stageMapByLead(args)).map(([key, stage]) => [key, stage ? stage.count : null]));
}

const FUTURE_PAYMENT =
  /\b(pr[oó]xim[ao]|siguiente|segunda|tercera|resto|restante|saldo|pendiente)\s+(cuota|pago|parte)\b|\b(pagar[áa]?|cobrar|abonar[áa]?|vence|completar[áa]? el pago)\b/i;
const PAYMENT_TYPE = /pago|cobr|cuota|saldo/i;

/**
 * The one sentence a Cerró keeps after «Cerró. Pagó X de Y; falta Z.»: the next cuota, if known.
 * From the agreement (future payment sentences only) or an open payment follow-up with a date.
 */
export function nextCuotaSentence(
  agreed: string,
  openAlert: Pick<FactAlert, "type" | "dueAt"> | undefined,
  today: string,
) {
  const sentence = String(agreed || "")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .find((part) => FUTURE_PAYMENT.test(part) && !/^pag[oó]\b/i.test(part));
  if (sentence) return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  const due = dayOf(openAlert?.dueAt || null);
  if (openAlert && due && PAYMENT_TYPE.test(String(openAlert.type || ""))) {
    return `Próxima cuota: ${shortDate(due, today)}.`;
  }
  return "";
}

export function buildPersonFacts(args: {
  lead: FactLead | null;
  /** Used when there is no lead row: a name from a call. */
  name?: string;
  calls: readonly FactCall[];
  alerts?: readonly FactAlert[];
  scripts?: OfferScript[];
  now?: Date;
  /** Day (YYYY-MM-DD) of the call the ficha was opened from, when it is not a CRM call (old Fathom row). */
  openedFromDay?: string | null;
}): PersonFacts {
  const now = args.now || new Date();
  const today = zonedDayKey(now);
  const lead = args.lead;
  const name = String(lead?.name || args.name || "").trim();
  const calls = [...args.calls].sort((a, b) => callDay(b).localeCompare(callDay(a)));
  const last = calls[0];
  const lastFiling = filingOf(last?.filingJson);
  const alerts = [...(args.alerts || [])];
  const { status, ended, lost, reason: lostReason } = statusOf(lead, calls, alerts);

  const offer =
    shownOffer(lead?.offerName) ||
    calls.map((call) => shownOffer(filingOf(call.filingJson).producto) || shownOffer(call.offerName)).find(Boolean) ||
    "";
  const phone =
    String(lead?.telefono || "").trim() ||
    calls.map((call) => String(filingOf(call.filingJson).telefono || "").trim()).find(Boolean) ||
    "";

  const open = alerts
    .filter((row) => !row.resolvedAt)
    .sort((a, b) => dayOf(a.dueAt).localeCompare(dayOf(b.dueAt)))[0];
  const proximo = String(lastFiling.proximo_seguimiento || "");
  const nextDay = ended ? "" : dayOf(open?.dueAt) || (/^\d{4}-\d{2}-\d{2}/.test(proximo) ? proximo.slice(0, 10) : "") || dayOf(lead?.nextStepAt || null);

  const summary: AgreementSummary = agreementSummary({
    agreements: [lastFiling.acuerdo_seguimiento, lead?.nextStep, ...calls.slice(1).map((call) => filingOf(call.filingJson).acuerdo_seguimiento)],
    notes: [lastFiling.notas_crm, last?.summary, lead?.lastSummary],
    tipo: ended ? "" : lastFiling.tipo_seguimiento || open?.type || "",
    proximo: nextDay,
    today,
  });
  if (summary.agreed) {
    summary.agreed = closerFacingNote(summary.agreed);
    summary.text = [summary.agreed, summary.missing].filter(Boolean).join(" ");
  }

  // Money: one truth (deal-money), the same the CRM row and Comisiones read.
  const sale = saleCall(
    calls.map((call) => ({
      call,
      venta: call.ventaTotal ?? filingOf(call.filingJson).venta_total,
      cash: call.cashCollected ?? filingOf(call.filingJson).cash_collected,
    })),
  );
  const deal = dealMoney({
    venta: sale?.venta ?? (Number(String(lead?.amountTalked || "").replace(/[^\d.]/g, "")) || null),
    cash: sale?.cash ?? (Number(String(lead?.amountPaid || "").replace(/[^\d.]/g, "")) || null),
    saldo: sale ? (sale.call.saldoPendiente ?? filingOf(sale.call.filingJson).saldo_pendiente) : null,
  });

  // The status wins: a Perdido says it was lost and why; a Cerró says what was paid.
  if (lost) {
    const why = objectionPhrase(lostReason);
    const text = why ? `Se perdió. Lo que frenó la venta fue ${why}.` : "Se perdió. No quedó anotada la razón.";
    summary.agreed = "";
    summary.missing = "";
    summary.text = text;
    summary.clear = true;
  } else if (status === "Cerró") {
    const paid =
      deal.total > 0 && deal.falta > 0
        ? `Cerró. Pagó ${money(deal.pagado) || "USD 0"} de ${money(deal.total)}; falta ${money(deal.falta)}.`
        : deal.total > 0
          ? `Cerró. Pagó ${money(deal.pagado || deal.total)}.`
          : "Cerró.";
    // Only what still has to be paid; pre-close items («Segunda reunión agendada.») don't belong.
    const cuota = nextCuotaSentence(summary.agreed, deal.falta > 0 ? open : undefined, today);
    summary.agreed = cuota;
    summary.missing = "";
    summary.text = [paid, cuota].filter(Boolean).join(" ");
    summary.clear = true;
  }

  const lastCallDay = last ? callDay(last) : "";
  const stage = personStage({ lead, calls, alerts });

  const history: HistoryItem[] = [];
  for (const call of calls) {
    const day = callDay(call);
    if (!day) continue;
    const estado = plainStatus(filingOf(call.filingJson).estado_agenda || call.estadoAgenda || "");
    history.push({ day, date: shortDate(day, today), label: estado && estado !== "—" ? `Llamada · ${estado}` : "Llamada", kind: "call" });
  }
  for (const alert of alerts) {
    const result = String(alert.resultado || "").trim().toLowerCase();
    const day = dayOf(alert.resolvedAt);
    if (!day || !RESULT_LABEL[result]) continue;
    history.push({ day, date: shortDate(day, today), label: `Seguimiento · ${RESULT_LABEL[result]}`, kind: "followup" });
  }
  const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(String(args.openedFromDay || "")) ? String(args.openedFromDay) : "";
  if (fromDay && !history.some((item) => item.kind === "call" && item.day === fromDay)) {
    history.push({ day: fromDay, date: shortDate(fromDay, today), label: "Llamada", kind: "call" });
  }
  history.sort((a, b) => b.day.localeCompare(a.day) || (a.kind === "call" ? -1 : 1));
  // The same call saved twice (same day, same result) is one line.
  for (let index = history.length - 1; index > 0; index -= 1) {
    const item = history[index];
    if (history.slice(0, index).some((prev) => prev.day === item.day && prev.label === item.label)) history.splice(index, 1);
  }

  const lastContact = history[0]
    ? {
        day: history[0].day,
        kind: history[0].kind,
        resultado: history[0].label.split(" · ")[1] || "",
      }
    : null;

  const razones = uniq(
    [lead?.razonNoCierre, ...calls.map((call) => filingOf(call.filingJson).razon_no_cierre)]
      .map((value) => String(value || "").trim())
      .filter((value) => value && !/^otro$/i.test(value)),
  );
  const objections = uniq([String(lead?.objections || "").trim(), ...razones].filter(Boolean)).map(objectionPhrase).filter(Boolean);
  const venta = money(deal.total);
  const modo = calls.map((call) => String(call.modoPago || filingOf(call.filingJson).modo_pago || "").trim()).find(Boolean) || "";

  const details = {
    decisor: String(lead?.decider || "").trim(),
    objeciones: objections.join("; "),
    presupuesto: venta,
    formaPago: modo ? plainStatus(modo).toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "",
    pagado: money(deal.pagado),
    saldo: money(deal.falta),
    acuerdos: uniqNear(
      calls
        .map((call) => agreementFromField(filingOf(call.filingJson).acuerdo_seguimiento))
        .concat(agreementFromField(lead?.nextStep))
        .map((text) => closerFacingNote(text))
        .filter(Boolean),
    ),
    razonNoCierre: razones.join("; "),
    notas: uniqNear(
      calls
        .map((call) => closerFacingNote(cleanNote(String(filingOf(call.filingJson).notas_crm || call.summary || ""), 3)))
        .filter(Boolean),
    ).slice(0, 4),
  };

  const messages = personMessages({
    firstName: firstNameOf(name),
    offer,
    status: lost ? "lost" : status === "Cerró" ? "won" : "open",
    agreed: summary.agreed,
    tipo: String(lastFiling.tipo_seguimiento || open?.type || ""),
    objection: [lead?.objections, ...razones].filter(Boolean).join("; "),
    decisor: String(lead?.decider || ""),
    falta: status === "Cerró" && deal.falta > 0 ? money(deal.falta) : "",
  });

  return {
    leadId: lead?.id || "",
    name,
    firstName: firstNameOf(name),
    offer,
    phone,
    status,
    ended,
    summary,
    stage,
    nextDay,
    lastCallDay,
    lastContact,
    details,
    history,
    messages,
    openAlertId: open?.id || "",
    callId: last?.id || "",
  };
}

/** «Pendiente desde el 23 sep (16 días)», «Le toca el 12 oct», «Hoy». */
export function nextLine(facts: Pick<PersonFacts, "nextDay">, now = new Date()) {
  if (!facts.nextDay) return "";
  const today = zonedDayKey(now);
  const diff = calendarDaysBetween(facts.nextDay, today);
  if (diff === 0) return "Le toca hoy";
  if (diff === 1) return "Le toca mañana";
  if (diff > 1) return `Le toca el ${shortDate(facts.nextDay, today)}`;
  const late = -diff;
  return `Pendiente desde el ${shortDate(facts.nextDay, today)} (${late === 1 ? "1 día" : `${late} días`})`;
}
