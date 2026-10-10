import { agreementSummary, agreementFromField, wholeSentences, type AgreementSummary } from "@/lib/agreement-summary";
import { calendarDaysBetween, zonedDayKey } from "@/lib/crm-time";
import { followupStage, type FollowupStage } from "@/lib/followup-stage";
import { closerFacingNote, messageIdeas, shownOffer, type OfferScript } from "@/lib/inicio-view";
import { samePersonName } from "@/lib/lead-match";
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

/** Calls of this person: stamped with the lead id, or the same full name. */
export function callsForPerson(lead: { id: string; name: string }, calls: readonly FactCall[]) {
  return calls.filter((call) => {
    const filing = filingOf(call.filingJson);
    if (filing.lead_id) return filing.lead_id === lead.id;
    const name = String(call.leadName || filing.cliente_real || "").trim();
    return Boolean(name) && samePersonName(lead.name, name);
  });
}

const ENDED_STATUS = /^(cerrad|ganad|perdid|cliente)/i;

function statusOf(lead: FactLead | null, last: FactCall | undefined) {
  const raw = String(lead?.status || "").trim().toLowerCase();
  const estado = String(filingOf(last?.filingJson).estado_agenda || last?.estadoAgenda || "").toUpperCase();
  const lost = /perdid/.test(raw) || String(filingOf(last?.filingJson).seguimiento_resultado || "") === "perdido";
  if (lost) return { status: "Perdido", ended: true };
  if (/cerrad|ganad|cliente/.test(raw) || estado === "CIERRE VENTA") return { status: "Cerró", ended: true };
  return { status: "En seguimiento", ended: ENDED_STATUS.test(raw) };
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

function moneyText(value: string | null | undefined) {
  const n = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? moneyLabel(n, "USD") : "";
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

export function buildPersonFacts(args: {
  lead: FactLead | null;
  /** Used when there is no lead row: a name from a call. */
  name?: string;
  calls: readonly FactCall[];
  alerts?: readonly FactAlert[];
  scripts?: OfferScript[];
  now?: Date;
}): PersonFacts {
  const now = args.now || new Date();
  const today = zonedDayKey(now);
  const lead = args.lead;
  const name = String(lead?.name || args.name || "").trim();
  const calls = [...args.calls].sort((a, b) => callDay(b).localeCompare(callDay(a)));
  const last = calls[0];
  const lastFiling = filingOf(last?.filingJson);
  const alerts = [...(args.alerts || [])];
  const { status, ended } = statusOf(lead, last);

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

  const summary = agreementSummary({
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

  const lastCallDay = last ? callDay(last) : "";
  const stage = ended
    ? null
    : followupStage({
        status: lead?.status,
        callDates: calls.map((call) => call.recordedAt || call.createdAt || null),
        attempts: alerts.map((row) => ({ at: row.resolvedAt, resultado: row.resultado })),
        lastCallAttempts: last
          ? { intentos: lastFiling.seguimiento_intentos, resultado: lastFiling.seguimiento_resultado }
          : null,
      });

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
  history.sort((a, b) => b.day.localeCompare(a.day) || (a.kind === "call" ? -1 : 1));

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
  const venta = calls.map((call) => money(call.ventaTotal ?? filingOf(call.filingJson).venta_total)).find(Boolean) || moneyText(lead?.amountTalked);
  const cash = calls.reduce((sum, call) => sum + (Number(call.cashCollected ?? filingOf(call.filingJson).cash_collected) || 0), 0);
  const saldo = money(last?.saldoPendiente ?? lastFiling.saldo_pendiente);
  const modo = calls.map((call) => String(call.modoPago || filingOf(call.filingJson).modo_pago || "").trim()).find(Boolean) || "";

  const details = {
    decisor: String(lead?.decider || "").trim(),
    objeciones: objections.join("; "),
    presupuesto: venta,
    formaPago: modo ? plainStatus(modo).toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "",
    pagado: money(cash) || moneyText(lead?.amountPaid),
    saldo,
    acuerdos: uniq(
      calls
        .map((call) => agreementFromField(filingOf(call.filingJson).acuerdo_seguimiento))
        .concat(agreementFromField(lead?.nextStep))
        .map((text) => closerFacingNote(text))
        .filter(Boolean),
    ),
    razonNoCierre: razones.join("; "),
    notas: uniq(
      calls
        .map((call) => wholeSentences(String(filingOf(call.filingJson).notas_crm || call.summary || ""), 3))
        .filter(Boolean),
    ).slice(0, 4),
  };

  const messages = ended
    ? []
    : messageIdeas({
        name,
        offer,
        suggested: open?.mensajeSugerido || "",
        scripts: args.scripts || [],
        step: summary.clear ? summary.agreed : "",
        tipo: lastFiling.tipo_seguimiento || open?.type || "",
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
