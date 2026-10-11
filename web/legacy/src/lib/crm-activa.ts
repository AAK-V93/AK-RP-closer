import { foldLeadName } from "@/lib/crm-followups";
import { realClientName } from "@/lib/crm-noise";
import { samePersonName } from "@/lib/lead-match";

/** Lead statuses that still have something to close or collect. */
const ACTIVE_STATUS = new Set(["seguimiento", "pendiente", "cobro", "nuevo"]);

export const ACTIVA_EXPLAIN =
  "Activa quiere decir que el lead sigue en juego: todavía puedes cerrar o cobrar. No cuenta si ya cerró, si se perdió o si la fila es una llamada interna.";

export function statusFromEstadoAgenda(estado: string | null | undefined) {
  const value = String(estado || "").trim().toUpperCase();
  if (value === "CIERRE VENTA") return "cerrado";
  if (value === "ACUERDO SIN PAGO") return "cobro";
  return "seguimiento";
}

/**
 * One opportunity = one named lead you can still close or collect from.
 * Closed, lost, nameless and internal rows are not active.
 */
export function isOportunidadActiva(input: {
  status?: string | null;
  cliente?: string | null;
  interna?: boolean;
  estadoAgenda?: string | null;
}) {
  if (input.interna) return false;
  if (!realClientName(input.cliente)) return false;
  const status = String(input.status || "").trim().toLowerCase();
  if (status) return ACTIVE_STATUS.has(status);
  return String(input.estadoAgenda || "").trim().toUpperCase() !== "CIERRE VENTA";
}

export function countOportunidadesActivas(
  leads: { name?: string | null; status?: string | null }[],
) {
  const seen = new Set<string>();
  let count = 0;
  for (const lead of leads) {
    const key = foldLeadName(lead.name || "");
    if (!key || seen.has(key)) continue;
    if (!isOportunidadActiva({ status: lead.status, cliente: lead.name })) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

export function filaCountLabel(shown: number, total: number) {
  const left = shown === 1 ? "1 fila" : `${shown} filas`;
  if (shown === total) return left;
  const right = total === 1 ? "1 fila" : `${total} filas`;
  return `${shown} de ${right}`;
}

type ActiveRow = {
  id?: string;
  cliente?: string | null;
  fecha?: string | null;
  leadStatus?: string | null;
  interna?: boolean;
  estadoAgenda?: string | null;
};

/**
 * One row per active opportunity: the latest call of each lead that
 * isOportunidadActiva still counts. A row with no lead status does not
 * sneak in through the empty-status fallback.
 */
export function latestActiveRows<T extends ActiveRow>(rows: T[]) {
  const best = new Map<string, T>();
  for (const row of rows) {
    const status = String(row.leadStatus || "").trim();
    if (
      !isOportunidadActiva({
        status,
        cliente: row.cliente,
        interna: row.interna,
        estadoAgenda: row.estadoAgenda,
      })
    ) {
      continue;
    }
    if (!status) continue;
    const key = foldLeadName(row.cliente || "");
    if (!key) continue;
    const prev = best.get(key);
    const fecha = String(row.fecha || "");
    const prevFecha = String(prev?.fecha || "");
    if (!prev || fecha > prevFecha || (fecha === prevFecha && String(row.id || "") > String(prev.id || ""))) {
      best.set(key, row);
    }
  }
  const chosen = new Set(best.values());
  return rows.filter((row) => chosen.has(row));
}

function rowCoversLead(
  row: { cliente?: string | null; interna?: boolean; leadStatus?: string | null; estadoAgenda?: string | null },
  lead: { name: string; status?: string | null },
) {
  if (row.interna) return false;
  const cliente = String(row.cliente || "");
  if (!cliente) return false;
  if (foldLeadName(cliente) !== foldLeadName(lead.name) && !samePersonName(lead.name, cliente)) {
    return false;
  }
  return isOportunidadActiva({
    status: row.leadStatus || lead.status,
    cliente,
    interna: row.interna,
    estadoAgenda: row.estadoAgenda,
  });
}

/**
 * Every active lead gets a row. A call stored under a longer name still covers
 * that lead. A lead with no call gets the blank row from `blank`.
 */
export function withEveryActiveLead<T extends ActiveRow & { leadId?: string }>(
  rows: T[],
  leads: { id: string; name?: string | null; status?: string | null }[],
  blank: (lead: { id: string; name: string; status: string }) => T,
) {
  const linked = rows.map((row) => {
    if (String(row.leadStatus || "").trim()) return row;
    const lead = leads.find(
      (item) =>
        foldLeadName(item.name || "") === foldLeadName(row.cliente || "") ||
        samePersonName(item.name || "", row.cliente || ""),
    );
    if (!lead?.status) return row;
    return { ...row, leadStatus: lead.status, leadId: row.leadId || lead.id };
  });
  const missing = leads.filter((lead) => {
    const name = String(lead.name || "").trim();
    const status = String(lead.status || "");
    if (!isOportunidadActiva({ status, cliente: name })) return false;
    return !linked.some((row) => rowCoversLead(row, { name, status }));
  });
  return [
    ...linked,
    ...missing.map((lead) =>
      blank({ id: lead.id, name: String(lead.name || "").trim(), status: String(lead.status || "") }),
    ),
  ];
}

/** Counts on Operación. Solo activas matches filas with activas, or says why not. */
export function operacionCountLine(args: {
  shown: number;
  inScope: number;
  onlyActivas: boolean;
  activeRows: number;
  oportunidades: number;
}) {
  const filas = filaCountLabel(args.shown, args.inScope);
  if (!args.onlyActivas) {
    const activas =
      args.oportunidades === 1 ? "1 oportunidad activa" : `${args.oportunidades} oportunidades activas`;
    return `${filas} · ${activas}`;
  }
  if (args.shown === args.inScope && args.activeRows === args.oportunidades) {
    return `${filas} · ${args.activeRows} activas`;
  }
  if (args.activeRows < args.oportunidades) {
    const missing = args.oportunidades - args.activeRows;
    const rest =
      missing === 1
        ? "1 activa no tiene fila en esta lista"
        : `${missing} activas no tienen fila en esta lista`;
    return `${filas} · ${args.oportunidades} oportunidades activas. ${rest}.`;
  }
  return `${filas} · ${args.activeRows} activas`;
}
