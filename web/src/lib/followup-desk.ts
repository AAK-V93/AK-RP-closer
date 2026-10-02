import {
  dueDayFromProximo,
  foldLeadName,
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
  },
): { rows: T[]; leaves: boolean; proximo: string } {
  const current = rows.find((row) => row.id === args.targetId);
  if (!current) return { rows, leaves: false, proximo: "" };

  const terminal =
    args.action === "mostro" ||
    args.action === "perdido" ||
    (args.action === "hecho" && !current.nextOnHecho) ||
    (args.action === "cerro" && !current.nextOnHecho) ||
    (args.action === "pago" && !current.nextOnHecho);

  if (terminal) {
    return {
      rows: rows.filter((row) => row.id !== args.targetId),
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

export function projectOperacionProximo<T extends OperacionPatch>(
  rows: T[],
  args: {
    callId?: string;
    cliente: string;
    proximo: string;
    resultado: string;
    closeAll: boolean;
  },
): T[] {
  const key = foldLeadName(args.cliente);
  let patchedOpen = false;
  return rows.map((row) => {
    if (!key || foldLeadName(row.cliente) !== key) return row;
    if (args.closeAll) {
      if (!dueDayFromProximo(row.fechaProximo) && row.id !== args.callId) return row;
      return {
        ...row,
        fechaProximo: "",
        seguimientoResultado: args.resultado,
        seguimientoHecho: dueDayFromProximo(row.fechaProximo)
          ? row.fechaProximo
          : row.seguimientoHecho || "",
        seguimientoCerrado: true,
      };
    }
    const isTarget = args.callId
      ? row.id === args.callId
      : !patchedOpen && Boolean(dueDayFromProximo(row.fechaProximo));
    if (!isTarget) return row;
    patchedOpen = true;
    return {
      ...row,
      fechaProximo: args.proximo,
      seguimientoResultado: args.resultado,
      seguimientoHecho: "",
      seguimientoCerrado: false,
    };
  });
}

export function deskUndoMessage(args: {
  action: DeskResultado;
  nombre: string;
  proximo: string;
  leaves: boolean;
}) {
  const nombre = args.nombre || "el lead";
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
  if (args.action === "mostro") return `Marcaste que ${nombre} mostró.`;
  if (args.action === "perdido") return `Marcaste a ${nombre} como perdido.`;
  if (args.action === "cerro" && args.leaves) return `Marcaste que ${nombre} cerró.`;
  if (args.action === "cerro") return `${nombre} cerró. Queda un cobro para el ${args.proximo}.`;
  if (args.action === "reprogramado") return `Reprogramaste a ${nombre} para el ${args.proximo}.`;
  return "Listo.";
}
