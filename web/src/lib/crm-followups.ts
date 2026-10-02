import { calendarDaysBetween } from "@/lib/crm-time";

export type FollowupEstado = "VENCIDO" | "HOY" | "PRÓXIMO";

/** The day Operación prints in Próx. seg., not a UTC reinterpretation of the instant. */
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
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function moneyInPlay(row: {
  venta?: number | null;
  cash?: number | null;
  saldo?: number | null;
}) {
  const sane = (amount: number | null | undefined) =>
    amount != null &&
    Number.isFinite(amount) &&
    amount > 0 &&
    amount <= 1_000_000
      ? amount
      : 0;
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
  const byLead = new Map<
    string,
    OperacionFollowupSource & { dueDay: string }
  >();
  for (const row of operacion) {
    const dueDay = dueDayFromProximo(row.fechaProximo);
    const key = foldLeadName(row.cliente);
    if (!dueDay || !key || byLead.has(key)) continue;
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
      dueAt: draft.dueAt,
      estado: draft.estado,
      days: Math.max(0, draft.days),
      enJuego: draft.enJuego > 0 ? draft.enJuego : row.enJuego,
      proximaAccion: action,
    });
  }

  for (const source of byLead.values()) {
    aligned.push(create(draftFor(source, source.dueDay, today)));
  }
  return aligned;
}

export function followupSnapshot(rows: { estado: string; enJuego?: number }[]) {
  return {
    seguimientosVencidos: rows.filter((row) => row.estado === "VENCIDO").length,
    seguimientosHoy: rows.filter((row) => row.estado === "HOY").length,
    dineroEnJuego: rows.reduce((sum, row) => sum + (row.enJuego || 0), 0),
  };
}
