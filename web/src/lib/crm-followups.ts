import { calendarDaysBetween } from "@/lib/crm-time";
import { normalizePersonName } from "@/lib/lead-match";
import { countedSale } from "@/lib/stated-deal";
import { plainStatus } from "@/lib/plain-labels";
import { clipVisible } from "@/lib/visible-text";

export const DINERO_EN_JUEGO_NOTE =
  "Dinero en juego es el saldo abierto de cada lead con un próximo seguimiento. Cada persona cuenta una vez. Un año, un teléfono o el texto del precio no entran.";

export type FollowupEstado = "VENCIDO" | "HOY" | "PRÓXIMO";

/** The day Operación prints in Próx. seg., not a UTC reinterpretation of the instant. */
const CLOSED_RESULTS = new Set(["hecho", "mostro", "mostró", "perdido", "cerro", "pago"]);

/** The closer finished this próximo, so a transcript must not open it again. */
export function followupIsClosed(raw: {
  seguimiento_resultado?: unknown;
  proximo_seguimiento?: unknown;
}) {
  const resultado = String(raw.seguimiento_resultado || "").trim().toLowerCase();
  const proximo = String(raw.proximo_seguimiento || "").trim();
  return CLOSED_RESULTS.has(resultado) && !dueDayFromProximo(proximo);
}

export function dueDayFromProximo(value: string | null | undefined) {
  const day = String(value || "")
    .trim()
    .slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

export function followupEstado(dueDay: string, today: string): FollowupEstado {
  if (dueDay < today) return "VENCIDO";
  if (dueDay === today) return "HOY";
  return "PRÓXIMO";
}

export function foldLeadName(value: string) {
  return normalizePersonName(value);
}

export function moneyInPlay(row: {
  venta?: number | null;
  cash?: number | null;
  saldo?: number | null;
  at?: Date | string | null;
  prices?: number[];
}) {
  const sane = (amount: number | null | undefined) =>
    countedSale(amount, { at: row.at, prices: row.prices });
  const saldo = sane(row.saldo);
  if (saldo) return saldo;
  const venta = sane(row.venta);
  const cash = sane(row.cash);
  if (venta > cash) return venta - cash;
  return 0;
}

function storedTimingSuffix(action: string) {
  const match = String(action || "").match(
    /\s·\s*(vencido|atrasado|pendiente de hoy|hace \d+ d[ií]as sin respuesta)\s*$/i,
  );
  if (!match) return "";
  if (/vencido|atrasado/i.test(match[1])) return " · atrasado";
  return ` · ${match[1]}`;
}

/** Drop a timing suffix already stored on an action, including the old «vencido». */
export function stripStoredFollowupMark(value: string) {
  return String(value || "")
    .replace(/\s*·\s*(vencido|atrasado|pendiente de hoy|hace \d+ d[ií]as sin respuesta)\s*$/i, "")
    .trim();
}

export function withFollowupTiming(action: string, estado: FollowupEstado) {
  const base = stripStoredFollowupMark(action);
  if (!base) {
    if (estado === "VENCIDO") return "atrasado";
    if (estado === "HOY") return "pendiente de hoy";
    return "";
  }
  if (estado === "VENCIDO") return `${base} · atrasado`;
  if (estado === "HOY") return `${base} · pendiente de hoy`;
  return base;
}

export function followupTouchLabel(estado: FollowupEstado, daysAhead: number) {
  if (estado === "VENCIDO") {
    const late = Math.max(1, -daysAhead);
    return late === 1 ? "hace 1 día sin respuesta" : `hace ${late} días sin respuesta`;
  }
  if (estado === "HOY") return "hoy";
  const n = Math.max(0, daysAhead);
  return n === 1 ? "en 1 día" : `en ${n} días`;
}

export type OperacionFollowupSource = {
  id: string;
  leadId?: string;
  cliente: string;
  fecha: string | null;
  fechaProximo: string;
  oferta: string;
  telefono: string;
  venta: number | null;
  cash: number | null;
  saldo: number | null;
  acuerdo: string;
  tipoSeguimiento: string;
  /** Newest call was closed by the closer, so an older date must not come back. */
  seguimientoCerrado?: boolean;
  interna?: boolean;
  estadoAgenda?: string;
  leadStatus?: string;
};

export type FollowupDraft = {
  source: OperacionFollowupSource;
  dueDay: string;
  estado: FollowupEstado;
  days: number;
  dueAt: string;
  enJuego: number;
  proximaAccion: string;
  ultimoToque: string;
};

type Alignable = {
  id: string;
  cliente: string;
  dueAt: string;
  estado: string;
  days: number;
  enJuego: number;
  proximaAccion: string;
  acuerdo?: string;
  callId?: string;
  proximo?: string;
  closesOnHecho?: boolean;
  nextOnHecho?: string;
  tipo?: string;
  hilo?: string;
  contexto?: string;
  estadoAgenda?: string;
  leadStatus?: string;
};

function draftFor(
  source: OperacionFollowupSource,
  dueDay: string,
  today: string,
): FollowupDraft {
  const estado = followupEstado(dueDay, today);
  const days = calendarDaysBetween(dueDay, today);
  const base =
    source.acuerdo.trim() || source.tipoSeguimiento.trim() || "seguimiento";
  return {
    source,
    dueDay,
    estado,
    days,
    dueAt: `${dueDay}T12:00:00.000Z`,
    enJuego: moneyInPlay(source),
    proximaAccion: withFollowupTiming(base, estado),
    ultimoToque: followupTouchLabel(estado, days),
  };
}

/**
 * Seguimientos and the counters use the same próximo seguimiento Operación shows.
 * One row per lead: the latest call that already has a date. An existing alert keeps
 * its id so its actions still work, but the day and the money come from that call.
 */
export function alignFollowups<T extends Alignable>(
  rows: T[],
  operacion: OperacionFollowupSource[],
  today: string,
  create: (draft: FollowupDraft) => T,
): T[] {
  const newestByLead = new Map<string, OperacionFollowupSource>();
  for (const row of operacion) {
    if (row.interna) continue;
    const key = foldLeadName(row.cliente);
    if (!key || newestByLead.has(key)) continue;
    newestByLead.set(key, row);
  }

  const byLead = new Map<
    string,
    OperacionFollowupSource & { dueDay: string }
  >();
  for (const row of operacion) {
    if (row.interna) continue;
    const key = foldLeadName(row.cliente);
    // No client means it is not a lead (internal session, coaching, práctica).
    if (!key || byLead.has(key)) continue;
    if (newestByLead.get(key)?.seguimientoCerrado) continue;
    const dueDay = dueDayFromProximo(row.fechaProximo);
    if (!dueDay) continue;
    byLead.set(key, { ...row, dueDay });
  }

  const seen = new Set<string>();
  const aligned: T[] = [];
  for (const row of rows) {
    const key = foldLeadName(row.cliente);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const source = key ? byLead.get(key) : undefined;
    if (!source) {
      if (!key) continue;
      if (newestByLead.get(key)?.seguimientoCerrado) continue;
      const due =
        dueDayFromProximo(row.proximo) ||
        dueDayFromProximo(String(row.dueAt || "").slice(0, 10));
      if (!due) continue;
      aligned.push(row);
      continue;
    }
    byLead.delete(key);
    const draft = draftFor(source, source.dueDay, today);
    const action = row.proximaAccion.trim()
      ? withFollowupTiming(row.proximaAccion, draft.estado)
      : draft.estado === "PRÓXIMO"
        ? row.proximaAccion
        : withFollowupTiming(
            row.acuerdo || source.acuerdo || "seguimiento",
            draft.estado,
          );
    aligned.push({
      ...row,
      callId: source.id,
      proximo: source.fechaProximo,
      dueAt: draft.dueAt,
      estado: draft.estado,
      days: Math.max(0, draft.days),
      enJuego: draft.enJuego,
      proximaAccion: action,
      estadoAgenda: source.estadoAgenda || row.estadoAgenda,
      leadStatus: source.leadStatus || row.leadStatus,
    });
  }

  for (const source of byLead.values()) {
    aligned.push(create(draftFor(source, source.dueDay, today)));
  }
  return aligned;
}

function sameFollowupCopy(left: string, right: string) {
  const norm = (value: string) => stripStoredFollowupMark(value).toLowerCase().replace(/\s+/g, " ").trim();
  const a = norm(left);
  const b = norm(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function closedSale(estadoAgenda?: string, leadStatus?: string) {
  const blob = `${estadoAgenda || ""} ${leadStatus || ""}`.toUpperCase().replace(/_/g, " ");
  return /\bCIERRE VENTA\b|\bACUERDO SIN PAGO\b|\bCERRADO\b|\bCERRO\b|\bCOBRO\b/.test(blob);
}

function salesMeeting(tipo: string, hilo: string) {
  const blob = `${hilo} ${tipo}`.toUpperCase().replace(/_/g, " ");
  return /\bSEGUNDA\b|\bREUNION\b|\bDECISION\b|\bREAGENDAR\b/.test(blob);
}

/** After a sale, a stored "segunda reunión" is onboarding or the next installment. */
export function applyClosedSaleFollowup<T extends Alignable>(row: T): T {
  const contexto = sameFollowupCopy(row.contexto || "", row.proximaAccion) ? "" : row.contexto;
  if (!closedSale(row.estadoAgenda, row.leadStatus) || !salesMeeting(row.tipo || "", row.hilo || "")) {
    return contexto === row.contexto ? row : { ...row, contexto };
  }
  const owes = (row.enJuego || 0) > 0;
  const timing = storedTimingSuffix(row.proximaAccion);
  const base = owes ? "cobrar la siguiente cuota" : "dar la bienvenida";
  return {
    ...row,
    tipo: owes ? "PAGO PENDIENTE" : "ONBOARDING",
    hilo: owes ? "COBRANZA" : "ONBOARDING",
    proximaAccion: `${base}${timing}`,
    contexto: "",
  };
}

/** The kind Operación and Seguimientos both show. Existing sales are rewritten here, not in the DB. */
export function followupKindForCall(row: {
  tipoSeguimiento?: string;
  estadoAgenda?: string;
  leadStatus?: string;
  venta?: number | null;
  cash?: number | null;
  saldo?: number | null;
}) {
  const adjusted = applyClosedSaleFollowup({
    id: "call",
    cliente: "",
    dueAt: "",
    estado: "",
    days: 0,
    enJuego: moneyInPlay({ venta: row.venta, cash: row.cash, saldo: row.saldo }),
    proximaAccion: "",
    tipo: row.tipoSeguimiento || "",
    hilo: row.tipoSeguimiento || "",
    estadoAgenda: row.estadoAgenda,
    leadStatus: row.leadStatus,
  });
  return adjusted.hilo || adjusted.tipo || row.tipoSeguimiento || "";
}

export function shownFollowupKind(
  call: {
    tipoSeguimiento?: string;
    estadoAgenda?: string;
    leadStatus?: string;
    venta?: number | null;
    cash?: number | null;
    saldo?: number | null;
  },
  followup?: {
    id?: string;
    cliente?: string;
    dueAt?: string;
    estado?: string;
    days?: number;
    enJuego?: number;
    proximaAccion?: string;
    tipo?: string;
    hilo?: string;
    contexto?: string;
  } | null,
) {
  if (!followup) return followupKindForCall(call);
  const adjusted = applyClosedSaleFollowup({
    id: followup.id || "followup",
    cliente: followup.cliente || "",
    dueAt: followup.dueAt || "",
    estado: followup.estado || "",
    days: followup.days || 0,
    enJuego: followup.enJuego ?? moneyInPlay(call),
    proximaAccion: followup.proximaAccion || "",
    tipo: followup.tipo || call.tipoSeguimiento || "",
    hilo: followup.hilo || followup.tipo || call.tipoSeguimiento || "",
    contexto: followup.contexto,
    estadoAgenda: call.estadoAgenda,
    leadStatus: call.leadStatus,
  });
  return adjusted.hilo || adjusted.tipo || followupKindForCall(call);
}

export type DeskFiling = {
  name: string;
  proximo: string;
  step: string;
  closed: boolean;
  estadoAgenda?: string;
  venta?: number | null;
  cash?: number | null;
  saldo?: number | null;
  note?: string;
  lastContact?: string;
  /** razon_no_cierre already stored on the filing. */
  objection?: string;
  /** producto on the filing, or the call's offer name. */
  offerName?: string;
  /** temperatura only when the filing or the call already has it. */
  temperature?: string;
};

export type DeskLine = {
  name: string;
  step: string;
  date: string;
  estado: "VENCIDO" | "HOY";
  amount: number;
  lateDays: number;
  reason: string;
  kind: "cobro" | "llamada";
  /** Stable tie-break. Same person and same numbers always land in the same place. */
  id?: string;
};

/**
 * One order for Inicio and for «¿A quién llamo hoy?».
 * Due rows first (more money, then more days late, then hotter stage, then name, then id).
 * Later dates follow, soonest first, with the same tie-break.
 */
export function compareFollowupRank(
  a: { id?: string; name: string; amount?: number; lateDays?: number; step?: string; daysAhead?: number },
  b: { id?: string; name: string; amount?: number; lateDays?: number; step?: string; daysAhead?: number },
) {
  const aFuture = (a.daysAhead || 0) > 0 ? 1 : 0;
  const bFuture = (b.daysAhead || 0) > 0 ? 1 : 0;
  return (
    aFuture - bFuture ||
    (aFuture ? (a.daysAhead || 0) - (b.daysAhead || 0) : 0) ||
    (b.amount || 0) - (a.amount || 0) ||
    (b.lateDays || 0) - (a.lateDays || 0) ||
    stageHeat(String(b.step || "")) - stageHeat(String(a.step || "")) ||
    a.name.localeCompare(b.name, "es") ||
    String(a.id || "").localeCompare(String(b.id || ""))
  );
}

/**
 * A seguimiento is open when the person has a name and a próximo day,
 * and the newest call for that person is not already closed.
 * One row per person. Includes later dates. Inicio, the CRM panel and the chat use this.
 */
export function pickOpenByName<T extends { name: string; due?: string | null; closed?: boolean }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const closedNames = new Set<string>();
  const chosen = new Map<string, T>();
  for (const row of rows) {
    const key = foldLeadName(row.name);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      if (row.closed) closedNames.add(key);
    }
    if (closedNames.has(key) || chosen.has(key)) continue;
    if (!dueDayFromProximo(row.due)) continue;
    chosen.set(key, row);
  }
  return [...chosen.values()];
}

export function openFollowupCountOf(
  rows: {
    cliente?: string;
    name?: string;
    proximo?: string | null;
    dueAt?: string | null;
    closed?: boolean;
  }[],
) {
  return pickOpenByName(
    rows.map((row) => ({
      name: String(row.cliente || row.name || ""),
      due: dueDayFromProximo(row.proximo) || dueDayFromProximo(String(row.dueAt || "").slice(0, 10)),
      closed: Boolean(row.closed),
    })),
  ).length;
}

function moneyEs(amount: number) {
  return String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function shortDay(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${Number(day)}/${Number(month)}/${year}`;
}

function daysBetween(due: string, today: string) {
  const start = Date.parse(`${due.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function bareFollowup(value: string) {
  const text = value.trim().toLowerCase();
  return !text || text === "—" || text === "seguimiento" || text === "seguimientos";
}

const MONTH_INDEX: Record<string, number> = {
  enero: 1,
  ene: 1,
  febrero: 2,
  feb: 2,
  marzo: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  julio: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  sept: 9,
  octubre: 10,
  oct: 10,
  noviembre: 11,
  nov: 11,
  diciembre: 12,
  dic: 12,
};

const MONTH_SHORT = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function foldDesk(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Cobro ahead of a decision, ahead of a meeting, ahead of a plain follow-up. */
export function stageHeat(step: string) {
  const text = foldDesk(step);
  if (/cobr|cuota|pago/.test(text)) return 5;
  if (/decisi/.test(text)) return 4;
  if (/reuni/.test(text)) return 3;
  if (/agenda/.test(text)) return 2;
  return 1;
}

function actionForStage(step: string) {
  const heat = stageHeat(step);
  if (heat >= 5) return "cobrar la cuota";
  if (heat === 4) return "pedir la decisión";
  if (heat === 3) return "confirmar la reunión";
  if (heat === 2) return "confirmar si se hizo";
  return "retomar el contacto";
}

function mentionedDay(note: string, today: string) {
  const year = Number(today.slice(0, 4)) || new Date().getUTCFullYear();
  const word = note.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)\b/i,
  );
  const iso = note.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const slash = note.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  let day = 0;
  let month = 0;
  let y = year;
  if (word) {
    day = Number(word[1]);
    month = MONTH_INDEX[foldDesk(word[2])] || 0;
  } else if (iso) {
    y = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (slash) {
    day = Number(slash[1]);
    month = Number(slash[2]);
    if (slash[3]) y = Number(slash[3]);
  }
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const key = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { key, label: `${day} ${MONTH_SHORT[month]}` };
}

function objectionLabel(raw: string) {
  const folded = foldDesk(raw);
  if (/precio|dinero/.test(folded)) return "precio";
  if (/momento/.test(folded)) return "el momento";
  if (/consult/.test(folded)) return "consultarlo";
  if (/confia|informacion/.test(folded)) return "confianza";
  if (/otra persona|ya compro/.test(folded)) return "que ya compró con otra persona";
  if (/no asist|no se present/.test(folded)) return "la inasistencia";
  const short = raw.split("/")[0]?.trim().replace(/[.?!…]+$/g, "") || "";
  if (!short || /^otro$/i.test(short)) return "";
  const clipped = short.length <= 42 ? short : clipVisible(short, 42);
  if (!clipped) return "";
  const mark = clipped.endsWith("…") ? "…" : "";
  const body = mark ? clipped.slice(0, -1) : clipped;
  return body.charAt(0).toLowerCase() + body.slice(1) + mark;
}

/** Only fields that are already on the filing. An empty set stays the generic step. */
function concreteFallback(
  step: string,
  extra?: { objection?: string; offerName?: string; temperature?: string },
) {
  const staged = actionForStage(step);
  if (staged !== "retomar el contacto") return staged;
  const objection = objectionLabel(String(extra?.objection || ""));
  if (objection) return `resolver la objeción de ${objection}`;
  const offer = String(extra?.offerName || "").trim();
  if (offer && !/^(otros|null|sin oferta)$/i.test(offer)) return `reenviar la oferta de ${offer}`;
  const temp = foldDesk(String(extra?.temperature || ""));
  if (temp === "alto" || temp === "caliente") return "pedir la decisión";
  if (temp === "medio") return "retomar con un mensaje concreto";
  if (temp === "bajo" || temp === "frio") return "llamar en frío";
  return staged;
}

/**
 * A long or third-person agreement becomes one short imperative.
 * Unknown prose is left alone so the caller can use a real field instead.
 */
function shortenAgreement(note: string) {
  const clean = note.trim().replace(/[.?!…]+$/g, "").trim();
  if (!clean) return null;
  const folded = foldDesk(clean);
  const narrative = /^(el|la|los|las)\s+(cliente|lead)\b/.test(folded);
  if (!narrative && clean.length <= 60) return null;
  if (/evalu/.test(folded) && /propuest/.test(folded)) {
    if (/\bevaluara\b|\bdara\b|\besperar\b/.test(folded)) return "esperar su respuesta a la propuesta";
    return "preguntar si ya evaluó la propuesta";
  }
  if (/propuest/.test(folded) && /respuest/.test(folded)) return "esperar su respuesta a la propuesta";
  if (/precio/.test(folded)) return "resolver la objeción de precio";
  if (/decidir|decision/.test(folded)) return "pedir la decisión";
  if (/\breuni/.test(folded)) return "confirmar la reunión";
  if (/cuota|\bcobr|\bpago\b/.test(folded)) return "cobrar la cuota";
  if (/oferta|propuest/.test(folded)) return "preguntar si ya evaluó la propuesta";
  return null;
}

/** A stored objection, not the generic «Otro». Combined with the agreement when both exist. */
function imperativeForObjection(raw: string | undefined, agreement: string) {
  const folded = foldDesk(String(raw || ""));
  if (!folded || /^otro\b/.test(folded)) return null;
  const agree = foldDesk(agreement);
  const proposal = /propuest|oferta|evalu/.test(agree);
  if (/consult/.test(folded)) {
    if (/pareja/.test(folded)) return "preguntar si ya lo consultó con su pareja y qué decidió";
    if (/socio/.test(folded)) return "preguntar si ya lo consultó con su socio y qué decidió";
    return "preguntar si ya lo consultó y qué decidió";
  }
  if (/precio|dinero/.test(folded)) {
    return proposal ? "preguntar si el precio de la propuesta le cierra" : "resolver la objeción de precio";
  }
  if (/tiempo|ocupad/.test(folded)) return "preguntar si ya tiene el tiempo";
  if (/confia|informacion/.test(folded)) return "preguntar si ya confía en la propuesta";
  if (/momento/.test(folded)) return "preguntar si ya es el momento";
  if (/otra persona|ya compro/.test(folded)) return "preguntar si sigue con la otra opción";
  if (/no asist|no se present/.test(folded)) return "reagendar la llamada";
  const label = objectionLabel(String(raw || ""));
  if (!label) return null;
  return `resolver la objeción de ${label}`;
}

function pastMeetingStep(
  note: string,
  today: string,
  extra?: { due?: string; step?: string; estado?: string },
) {
  const day = today.slice(0, 10);
  const mentioned = note ? mentionedDay(note, today) : null;
  if (mentioned && mentioned.key < day) {
    return `tenían reunión el ${mentioned.label}, reagendar`;
  }
  const blob = foldDesk(`${extra?.step || ""} ${extra?.estado || ""}`);
  const due = String(extra?.due || "").slice(0, 10);
  if (/reuni|reprogram/.test(blob) && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < day) {
    const label = mentionedDay(due, today)?.label || due;
    return `tenían reunión el ${label}, reagendar`;
  }
  return null;
}

/** The agreement is the next step. A missed meeting outranks an objection. Summaries are ignored. */
export function nextDeskStep(
  note: string,
  step: string,
  today: string,
  extra?: {
    objection?: string;
    offerName?: string;
    temperature?: string;
    due?: string;
    estado?: string;
  },
) {
  const clean = note.trim().replace(/[.?!…]+$/g, "").trim();
  const past = pastMeetingStep(clean, today, { ...extra, step });
  const fromObjection = imperativeForObjection(extra?.objection, clean);
  if (past && fromObjection) return `${past} y ${fromObjection}`;
  if (past) return past;
  if (fromObjection) return fromObjection;
  const shortened = shortenAgreement(clean);
  if (shortened) return shortened;
  if (!clean || bareFollowup(clean) || clean.length > 80 || /transcri/i.test(clean)) {
    return concreteFallback(step, extra);
  }
  return clean.charAt(0).toLowerCase() + clean.slice(1);
}

function deskReason(args: {
  owes: boolean;
  amount: number;
  lateDays: number;
  note: string;
  step: string;
  lastContact: string;
  today: string;
  due?: string;
  estado?: string;
  objection?: string;
  offerName?: string;
  temperature?: string;
}) {
  const late =
    args.lateDays > 0
      ? args.lateDays === 1
        ? "Hace 1 día sin respuesta"
        : `Hace ${args.lateDays} días sin respuesta`
      : "para hoy";
  const contact = args.lastContact ? `último contacto el ${shortDay(args.lastContact)}` : "";
  const next =
    args.owes && args.amount > 0
      ? args.lateDays > 0
        ? `cobrar la cuota de ${moneyEs(args.amount)}`
        : `cuota de ${moneyEs(args.amount)} vence hoy`
      : nextDeskStep(args.note, args.step, args.today, {
          objection: args.objection,
          offerName: args.offerName,
          temperature: args.temperature,
          due: args.due,
          estado: args.estado,
        });
  return [late, contact, next].filter(Boolean).join(", ");
}

/**
 * More money first. With no money, more days late, then the hotter stage
 * (cobro, decisión, reunión, seguimiento).
 */
export function prioritizeDesk(lines: DeskLine[]) {
  return [...lines].sort(compareFollowupRank);
}

/** Only the agreement. The call summary and the CRM note are not the next step. */
export function deskAgreement(filing: { acuerdo_seguimiento?: string | null }) {
  return String(filing.acuerdo_seguimiento || "").trim();
}

/** One open follow-up per person, only today and overdue. Newest call wins. */
export function deskLinesFromFilings(rows: DeskFiling[], today: string): DeskLine[] {
  const chosen = pickOpenByName(
    rows.map((row) => ({ ...row, name: row.name, due: row.proximo, closed: row.closed })),
  );
  const lines: DeskLine[] = [];
  for (const row of chosen) {
    const due = dueDayFromProximo(row.proximo);
    if (!due) continue;
    const estado = followupEstado(due, today);
    if (estado === "PRÓXIMO") continue;
    const saldo = row.saldo || 0;
    const gap = (row.venta || 0) > (row.cash || 0) ? (row.venta || 0) - (row.cash || 0) : 0;
    const amount = saldo > 0 ? saldo : gap;
    const owes = amount > 0;
    const labeled = plainStatus(row.step);
    const step = closedSale(row.estadoAgenda)
      ? owes
        ? "Cobro de la siguiente cuota"
        : "Bienvenida"
      : labeled === "—"
        ? "Seguimiento"
        : labeled;
    const lateDays = estado === "VENCIDO" ? Math.max(1, daysBetween(due, today)) : 0;
    const note = String(row.note || "").trim();
    lines.push({
      name: row.name.trim(),
      step,
      id: due + ":" + row.name.trim(),
      date: due,
      estado,
      amount,
      lateDays,
      kind: owes ? "cobro" : "llamada",
      reason: deskReason({
        owes,
        amount,
        lateDays,
        note,
        step,
        lastContact: String(row.lastContact || "").slice(0, 10),
        today,
        due,
        estado: row.estadoAgenda,
        objection: row.objection,
        offerName: row.offerName,
        temperature: row.temperature,
      }),
    });
  }
  return prioritizeDesk(lines);
}

function lowerStepAfterComma(reason: string) {
  const parts = reason.split(", ");
  if (parts.length < 2) return reason;
  const last = parts[parts.length - 1] || "";
  if (!last) return reason;
  parts[parts.length - 1] = last.charAt(0).toLowerCase() + last.slice(1);
  return parts.join(", ");
}

function reasonSentence(reason: string) {
  const text = lowerStepAfterComma(reason).trim().replace(/[.?!…]+$/g, "").trim();
  if (!text) return "Sin siguiente paso";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function finishDeskLine(prefix: string, body: string) {
  const shown = body.charAt(0).toUpperCase() + body.slice(1);
  return `${prefix}${shown}.`;
}

function splitDeskSentence(sentence: string) {
  const prefixes: string[] = [];
  const stepParts: string[] = [];
  let inStep = false;
  for (const part of sentence.split(", ")) {
    const meta = /contacto/i.test(part) || /^(hace \d+ d[ií]as sin respuesta|para hoy)\b/i.test(part);
    if (!inStep && meta) prefixes.push(part);
    else {
      inStep = true;
      stepParts.push(part);
    }
  }
  return { prefixes, step: stepParts.join(", ") };
}

/** A missed meeting can drop the objection tail when the full step does not fit. */
function meetingStepVariants(step: string) {
  if (!/^ten[ií]an reuni[oó]n/i.test(step)) return [step];
  const short = step.split(/ y /i)[0] || step;
  return short !== step ? [step, short] : [step];
}

function joinDesk(prefixes: string[], step: string) {
  return prefixes.length ? `${prefixes.join(", ")}, ${step}` : step;
}

/**
 * Near 120 characters. The step and the offer name stay whole.
 * Drop the last-contact phrase first. A missed meeting keeps reagendar
 * ahead of a long objection tail when both do not fit.
 */
export function deskCallLine(index: number, name: string, reason: string) {
  const sentence = reasonSentence(reason);
  const prefix = `${index}. ${name}. `;
  const full = `${prefix}${sentence}`;
  if (full.length <= 119) return `${full}.`;
  const { prefixes, step } = splitDeskSentence(sentence);
  const variants = meetingStepVariants(step || sentence);
  const contactless = prefixes.filter((part) => !/contacto/i.test(part));
  const lateOnly = contactless.filter((part) => /^(hace \d+ d[ií]as sin respuesta|para hoy)\b/i.test(part));
  const fits = (body: string) => `${prefix}${body}`.length <= 119;
  for (const variant of variants) {
    const bodies = [
      joinDesk(prefixes, variant),
      joinDesk(contactless, variant),
      joinDesk(lateOnly, variant),
    ];
    for (const body of bodies) {
      if (fits(body)) return finishDeskLine(prefix, body);
    }
  }
  return finishDeskLine(prefix, variants[0] || sentence);
}

/** «¿Qué tengo pendiente hoy?»: siempre dice lo de hoy y si hay cobros. */
export function formatPendingToday(lines: DeskLine[], unclassified = 0) {
  const overdue = lines.filter((row) => row.estado === "VENCIDO");
  const dueToday = lines.filter((row) => row.estado === "HOY");
  const cobros = lines.filter((row) => row.kind === "cobro");
  const llamadas = lines.filter((row) => row.kind !== "cobro");
  const todayText =
    dueToday.length === 0 ? "0 para hoy" : dueToday.length === 1 ? "1 para hoy" : `${dueToday.length} para hoy`;
  const overdueText =
    overdue.length === 0
      ? ""
      : overdue.length === 1
        ? "1 seguimiento atrasado"
        : `${overdue.length} seguimientos atrasados`;
  const head = overdueText ? `${overdueText}, ${todayText}` : todayText;
  let text = `Hoy tienes ${head}`;
  if (!cobros.length) {
    text += ", sin cobros pendientes.";
  } else {
    const saldo = cobros.reduce((sum, row) => sum + (row.amount || 0), 0);
    const who = cobros.length === 1 ? "1 cobro" : `${cobros.length} cobros`;
    text += saldo > 0 ? `, ${who}, USD ${moneyEs(saldo)} por cobrar.` : `, ${who}.`;
  }
  if (llamadas.length) {
    text += llamadas.length === 1 ? " 1 es una llamada." : ` ${llamadas.length} son llamadas.`;
  }
  if (unclassified > 0) {
    text +=
      unclassified === 1
        ? " También tienes 1 llamada por clasificar."
        : ` También tienes ${unclassified} llamadas por clasificar.`;
  }
  const top = prioritizeDesk(lines).slice(0, 3);
  if (top.length) {
    text += ` Lo más urgente: ${top.map((row) => `${row.name} (${reasonSentence(row.reason)})`).join("; ")}.`;
  }
  return text;
}

const CALL_ORDER =
  "Llama hoy, en este orden (más dinero primero; sin monto, más días sin respuesta y luego la etapa):";

/** «¿A quién llamo hoy?»: hasta 7, con el atraso visible y un solo punto final. */
export function formatWhoToCall(lines: DeskLine[]) {
  const ranked = prioritizeDesk(lines);
  const shown = ranked.slice(0, 7);
  if (!shown.length) return "Hoy no tienes a quién llamar. No hay atrasados ni nada pactado para hoy.";
  const body = shown.map((row, index) => deskCallLine(index + 1, row.name, row.reason)).join("\n");
  const rest = ranked.length - shown.length;
  const more = rest > 0 ? `\nQuedan ${rest} más después de estas.` : "";
  return `${CALL_ORDER}\n${body}${more}`;
}

export function formatPendingDesk(lines: DeskLine[], unclassified = 0) {
  return formatPendingToday(lines, unclassified);
}

/** Segunda reunión and any other meeting follow-up, not a call. */
export function isMeetingFollowup(tipo: string, hilo = "") {
  const blob = `${hilo} ${tipo}`.toUpperCase().replace(/_/g, " ");
  return blob.includes("SEGUNDA") || blob.includes("REUNION");
}

export function followupSnapshot(rows: { estado: string; enJuego?: number }[]) {
  return {
    seguimientosVencidos: rows.filter((row) => row.estado === "VENCIDO").length,
    seguimientosHoy: rows.filter((row) => row.estado === "HOY").length,
    dineroEnJuego: rows.reduce((sum, row) => sum + (row.enJuego || 0), 0),
  };
}
