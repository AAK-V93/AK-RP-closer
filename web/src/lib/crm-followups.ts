import { calendarDaysBetween } from "@/lib/crm-time";
import { normalizePersonName } from "@/lib/lead-match";
import { countedSale } from "@/lib/stated-deal";
import { plainStatus } from "@/lib/plain-labels";

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

export function withFollowupTiming(action: string, estado: FollowupEstado) {
  const base = action
    .replace(/\s*·\s*(vencido|pendiente de hoy)\s*$/i, "")
    .trim();
  if (!base) {
    if (estado === "VENCIDO") return "vencido";
    if (estado === "HOY") return "pendiente de hoy";
    return "";
  }
  if (estado === "VENCIDO") return `${base} · vencido`;
  if (estado === "HOY") return `${base} · pendiente de hoy`;
  return base;
}

export function followupTouchLabel(estado: FollowupEstado, daysAhead: number) {
  if (estado === "VENCIDO") return "vencido";
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
  const norm = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s*·\s*(vencido|pendiente de hoy)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
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
  const timing = row.proximaAccion.match(/\s·\s(?:vencido|pendiente de hoy)\s*$/i)?.[0] || "";
  const base = owes ? "cobrar la siguiente cuota" : "dar la bienvenida";
  return {
    ...row,
    tipo: owes ? "PAGO PENDIENTE" : "ONBOARDING",
    hilo: owes ? "COBRANZA" : "ONBOARDING",
    proximaAccion: `${base}${timing}`,
    contexto: "",
  };
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
};

export type DeskLine = {
  name: string;
  step: string;
  date: string;
  estado: "VENCIDO" | "HOY";
};

/** One open follow-up per person, only today and overdue. Newest call wins. */
export function deskLinesFromFilings(rows: DeskFiling[], today: string): DeskLine[] {
  const newestClosed = new Set<string>();
  const seen = new Set<string>();
  const chosen = new Map<string, DeskFiling & { due: string }>();
  for (const row of rows) {
    const key = foldLeadName(row.name);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      if (row.closed) newestClosed.add(key);
    }
    if (newestClosed.has(key) || chosen.has(key)) continue;
    const due = dueDayFromProximo(row.proximo);
    if (!due) continue;
    chosen.set(key, { ...row, due });
  }
  const lines: DeskLine[] = [];
  for (const row of chosen.values()) {
    const estado = followupEstado(row.due, today);
    if (estado === "PRÓXIMO") continue;
    const owes =
      (row.saldo || 0) > 0 || ((row.venta || 0) > (row.cash || 0) && (row.venta || 0) > 0);
    const labeled = plainStatus(row.step);
    const step = closedSale(row.estadoAgenda)
      ? owes
        ? "Cobro de la siguiente cuota"
        : "Bienvenida"
      : labeled === "—"
        ? "seguimiento"
        : labeled;
    lines.push({ name: row.name.trim(), step, date: row.due, estado });
  }
  return lines.sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "es"),
  );
}

export function formatPendingDesk(lines: DeskLine[]) {
  if (!lines.length) return "Hoy no tienes pendientes ni vencidos.";
  const overdue = lines.filter((row) => row.estado === "VENCIDO");
  const today = lines.filter((row) => row.estado === "HOY");
  const head = [
    overdue.length === 1 ? "1 vencido" : overdue.length ? `${overdue.length} vencidos` : "",
    today.length === 1 ? "1 pendiente de hoy" : today.length ? `${today.length} pendientes de hoy` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const body = lines.map((row) => `· ${row.name} — ${row.step} — ${row.date}`).join("\n");
  return `${head}.\n${body}`;
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
