import {
  dueDayFromProximo,
  followupEstado,
  withFollowupTiming,
} from "@/lib/crm-followups";
import { calendarDaysBetween, zonedDayKey, CRM_TIMEZONE } from "@/lib/crm-time";

export type DeskResultado =
  | "hecho"
  | "no_contesto"
  | "mostro"
  | "no_mostro"
  | "perdido"
  | "cerro"
  | "reprogramado"
  | "pago";

export const RESCHEDULE_RESULTS = new Set<DeskResultado>([
  "no_contesto",
  "no_mostro",
  "reprogramado",
]);

export function addCalendarDays(day: string, days: number) {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  if (![y, m, d].every((n) => Number.isFinite(n))) return "";
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function suggestNextFollowup(today: string, previous = "") {
  const day = addCalendarDays(today, 1);
  if (!day) return "";
  const clock = String(previous).match(/(\d{2}:\d{2})/);
  return clock ? `${day} ${clock[1]}` : day;
}

/** A closer-picked day, keeping the previous clock when there was one. */
export function normalizeFollowupWhen(raw: string, previous = ""): string | null {
  const day = String(raw || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  if (y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  const clock = String(previous).match(/(\d{2}:\d{2})/);
  return clock ? `${day} ${clock[1]}` : day;
}

/** Bogotá wall time, stored the same way Operación prints Próx. seg. */
export function instantFromProximo(value: string): Date | null {
  const text = normalizeFollowupWhen(value, value);
  if (!text) return null;
  const clock = text.match(/(\d{2}):(\d{2})/);
  const hh = clock ? clock[1] : "12";
  const mm = clock ? clock[2] : "00";
  const date = new Date(`${text.slice(0, 10)}T${hh}:${mm}:00-05:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function proximoFromInstant(date: Date, timeZone = CRM_TIMEZONE) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const day = zonedDayKey(date, timeZone);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value || "00";
  const minute = parts.find((part) => part.type === "minute")?.value || "00";
  if (date.toISOString().endsWith("T12:00:00.000Z")) return day;
  if (hour === "00" && minute === "00") return day;
  return `${day} ${hour}:${minute}`;
}

type DeskRow = {
  id: string;
  dueAt: string;
  estado: string;
  days: number;
  proximaAccion?: string;
  proximo?: string;
  closesOnHecho?: boolean;
  nextOnHecho?: string;
  ultimoToque?: string;
};

export function projectDeskRows<T extends DeskRow>(
  rows: T[],
  args: {
    targetId: string;
    action: DeskResultado;
    today: string;
    nextAt?: string;
    alsoDropIds?: string[];
  },
): { rows: T[]; leaves: boolean; proximo: string } {
  const current = rows.find((row) => row.id === args.targetId);
  if (!current) {
    if (args.action === "perdido" && args.alsoDropIds?.length) {
      const drop = new Set(args.alsoDropIds);
      const next = rows.filter((row) => !drop.has(row.id));
      return { rows: next, leaves: next.length !== rows.length, proximo: "" };
    }
    return { rows, leaves: false, proximo: "" };
  }

  const terminal =
    args.action === "mostro" ||
    args.action === "perdido" ||
    (args.action === "hecho" && !current.nextOnHecho) ||
    (args.action === "cerro" && !current.nextOnHecho) ||
    (args.action === "pago" && !current.nextOnHecho);

  if (terminal) {
    const drop = new Set(
      args.action === "perdido" ? [args.targetId, ...(args.alsoDropIds || [])] : [args.targetId],
    );
    return {
      rows: rows.filter((row) => !drop.has(row.id)),
      leaves: true,
      proximo: "",
    };
  }

  const scheduled =
    args.action === "hecho" || args.action === "cerro" || args.action === "pago"
      ? current.nextOnHecho || ""
      : normalizeFollowupWhen(args.nextAt || "", current.proximo || current.nextOnHecho || "") ||
        "";
  if (!scheduled) return { rows, leaves: false, proximo: current.proximo || "" };

  const dueDay = scheduled.slice(0, 10);
  const estado = followupEstado(dueDay, args.today);
  const touch =
    args.action === "no_mostro"
      ? "hoy · no mostró"
      : args.action === "no_contesto"
        ? "hoy · no contestó"
        : current.ultimoToque;
  return {
    leaves: false,
    proximo: scheduled,
    rows: rows.map((row) =>
      row.id !== args.targetId
        ? row
        : {
            ...row,
            dueAt: `${dueDay}T12:00:00.000Z`,
            estado,
            days: Math.max(0, calendarDaysBetween(dueDay, args.today)),
            proximaAccion: withFollowupTiming(row.proximaAccion || "seguimiento", estado),
            proximo: scheduled,
            ultimoToque: touch,
            closesOnHecho: row.closesOnHecho,
            nextOnHecho: "",
          },
    ),
  };
}

type OperacionPatch = {
  id: string;
  cliente: string;
  fechaProximo: string;
  seguimientoResultado?: string;
  seguimientoHecho?: string;
  seguimientoCerrado?: boolean;
};

export const LOST_REASONS = [
  { id: "precio", label: "Precio" },
  { id: "momento", label: "No es el momento" },
  { id: "otra", label: "Eligió otra opción" },
  { id: "no_responde", label: "No responde" },
  { id: "otro", label: "Otro" },
] as const;

export function formatLostReason(id: string, note = "") {
  const label = LOST_REASONS.find((row) => row.id === id)?.label || "";
  const extra = note.trim();
  if (id === "otro") return extra || "Otro";
  if (label && extra) return `${label}: ${extra}`;
  return label || extra;
}

export function lostScopeMessage(nombre: string, count: number) {
  const who = nombre.trim() || "este lead";
  const n = Math.max(1, count);
  if (n === 1) return `Esto cierra el seguimiento abierto de ${who}.`;
  return `Esto cierra los ${n} seguimientos abiertos de ${who}.`;
}

/** Perdido closes the lead. Every other button changes only the row you clicked. */
export function callIdsForDeskAction(args: {
  action: string;
  explicitCallId: string;
  leadId: string;
  linked: { id: string; leadId: string; open: boolean }[];
  /** Calls already stamped with a lead id, including ones with no alert. */
  stamped?: { id: string; leadId: string; open: boolean }[];
}) {
  if (args.action !== "perdido") return args.explicitCallId ? [args.explicitCallId] : [];
  const ids = new Set<string>();
  if (args.explicitCallId) ids.add(args.explicitCallId);
  if (!args.leadId) return [...ids];
  for (const row of [...args.linked, ...(args.stamped || [])]) {
    if (row.leadId === args.leadId && (row.open || row.id === args.explicitCallId)) ids.add(row.id);
  }
  return [...ids];
}

/** How many open Operación rows Perdido will close. Same lead id only. */
export function openFollowupCount(
  rows: { id: string; leadId?: string; fechaProximo?: string }[],
  leadId: string,
  explicitId = "",
) {
  if (!leadId) return 1;
  const n = rows.filter(
    (row) =>
      row.leadId === leadId &&
      (Boolean(String(row.fechaProximo || "").trim()) || row.id === explicitId),
  ).length;
  return Math.max(n, 1);
}

export function projectOperacionProximo<T extends OperacionPatch & { leadId?: string }>(
  rows: T[],
  args: {
    callId?: string;
    callIds?: string[];
    leadId?: string;
    cliente: string;
    proximo: string;
    resultado: string;
    closeAll: boolean;
  },
): T[] {
  const explicit = new Set(
    (args.callIds && args.callIds.length ? args.callIds : args.callId ? [args.callId] : []).filter(Boolean),
  );
  return rows.map((row) => {
    const open = Boolean(dueDayFromProximo(row.fechaProximo));
    const inScope = args.closeAll
      ? Boolean(args.leadId) &&
        row.leadId === args.leadId &&
        (open || explicit.has(row.id))
      : explicit.has(row.id);
    if (!inScope) return row;
    if (args.closeAll) {
      return {
        ...row,
        fechaProximo: "",
        seguimientoResultado: args.resultado,
        seguimientoHecho: open ? row.fechaProximo : row.seguimientoHecho || "",
        seguimientoCerrado: true,
      };
    }
    return {
      ...row,
      fechaProximo: args.proximo,
      seguimientoResultado: args.resultado,
      seguimientoHecho: "",
      seguimientoCerrado: false,
    };
  });
}

export type FollowupUndoCall = {
  id: string;
  proximo: string;
  resultado: string;
  cerrado: string;
  intentos: number;
  /** Real follow-up attempts (Hecho / No contestó) since the call. Missing on old snapshots. */
  contactos?: number;
  requiere: boolean | null;
  razonNoCierre?: string;
};

export type FollowupUndo = {
  calls: FollowupUndoCall[];
  resolvedAlertIds: string[];
  spawnedAlertIds: string[];
  threads: { id: string; estado: string; pasoActual: number; askLost: boolean }[];
  spawnedThreadIds: string[];
  lead: { id: string; status: string; nextStepAt: string | null; razonNoCierre: string } | null;
  touchedAfter: string;
};

function asStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

/** A partial or corrupt undo blob must not throw on Reabrir. */
export function normalizeFollowupUndo(value: unknown): FollowupUndo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<FollowupUndo>;
  if (!Array.isArray(row.calls)) return null;
  const calls = row.calls
    .filter((item): item is FollowupUndoCall => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: String(item.id || ""),
      proximo: String(item.proximo || ""),
      resultado: String(item.resultado || ""),
      cerrado: String(item.cerrado || ""),
      intentos: Number(item.intentos) || 0,
      ...(typeof item.contactos === "number" ? { contactos: Number(item.contactos) || 0 } : {}),
      requiere: item.requiere === true ? true : item.requiere === false ? false : null,
      ...(typeof item.razonNoCierre === "string" ? { razonNoCierre: item.razonNoCierre } : {}),
    }))
    .filter((item) => item.id);
  const threads = Array.isArray(row.threads)
    ? row.threads
        .filter((item) => item && typeof item === "object" && typeof item.id === "string")
        .map((item) => ({
          id: item.id,
          estado: String(item.estado || "activo"),
          pasoActual: Number(item.pasoActual) || 0,
          askLost: Boolean(item.askLost),
        }))
    : [];
  const lead =
    row.lead && typeof row.lead === "object" && typeof row.lead.id === "string"
      ? {
          id: row.lead.id,
          status: String(row.lead.status || ""),
          nextStepAt: row.lead.nextStepAt ? String(row.lead.nextStepAt) : null,
          razonNoCierre: String(row.lead.razonNoCierre || ""),
        }
      : null;
  return {
    calls,
    resolvedAlertIds: asStringList(row.resolvedAlertIds),
    spawnedAlertIds: asStringList(row.spawnedAlertIds),
    threads,
    spawnedThreadIds: asStringList(row.spawnedThreadIds),
    lead,
    touchedAfter: typeof row.touchedAfter === "string" ? row.touchedAfter : "",
  };
}

/**
 * Put back the próximo Hecho cleared. Uses the undo snapshot when it is readable,
 * and the saved `seguimiento_cerrado` date when the snapshot is missing or empty.
 */
export function restoreFollowupFiling(raw: unknown, snap?: FollowupUndoCall | null) {
  const filing =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  const fromSnap = String(snap?.proximo || "");
  const fromClosed = String(filing.seguimiento_cerrado || "");
  const proximo = dueDayFromProximo(fromSnap)
    ? fromSnap
    : dueDayFromProximo(fromClosed)
      ? fromClosed
      : "";
  if (!proximo && !snap) return { filing, proximo: "", restored: false };
  if (snap && dueDayFromProximo(fromSnap)) {
    filing.proximo_seguimiento = snap.proximo;
    filing.seguimiento_resultado = snap.resultado;
    filing.seguimiento_cerrado = snap.cerrado;
    filing.seguimiento_intentos = snap.intentos;
    if (typeof snap.contactos === "number") filing.seguimiento_contactos = snap.contactos;
    filing.requiere_seguimiento = snap.requiere;
    if (typeof snap.razonNoCierre === "string") filing.razon_no_cierre = snap.razonNoCierre;
  } else if (proximo) {
    filing.proximo_seguimiento = proximo;
    filing.seguimiento_resultado = "";
    filing.seguimiento_cerrado = "";
    filing.requiere_seguimiento = true;
  }
  delete filing.seguimiento_undo;
  return {
    filing,
    proximo: String(filing.proximo_seguimiento || ""),
    restored: Boolean(dueDayFromProximo(String(filing.proximo_seguimiento || ""))),
  };
}

export function deskUndoMessage(args: {
  action: DeskResultado;
  nombre: string;
  proximo: string;
  leaves: boolean;
  closedCount?: number;
}) {
  const nombre = args.nombre || "el lead";
  if (args.action === "perdido") return lostScopeMessage(nombre, args.closedCount || 1);
  if (args.action === "hecho" && args.leaves) return `Marcaste a ${nombre} como hecho.`;
  if (args.action === "hecho") {
    return `Marcaste a ${nombre} como hecho. El siguiente queda para el ${args.proximo}.`;
  }
  if (args.action === "no_contesto") {
    return `${nombre} no contestó. Sigue pendiente para el ${args.proximo}.`;
  }
  if (args.action === "no_mostro") {
    return `${nombre} no mostró. Sigue pendiente para el ${args.proximo}.`;
  }
  if (args.action === "mostro") return `Marcaste que ${nombre} mostró. Solo esta fila.`;
  if (args.action === "cerro" && args.leaves) return `Marcaste que ${nombre} cerró.`;
  if (args.action === "cerro") return `${nombre} cerró. Queda un cobro para el ${args.proximo}.`;
  if (args.action === "reprogramado") return `Reprogramaste a ${nombre} para el ${args.proximo}.`;
  return "Listo.";
}
