import { commissionOnAmount, resolveCommissionPct } from "@/lib/commission";
import {
  dueDayFromProximo,
  prioritizeDesk,
  stageHeat,
  type DeskLine,
} from "@/lib/crm-followups";
import { calendarDaysBetween, CRM_TIMEZONE, zonedDayKey, zonedParts } from "@/lib/crm-time";
import { parseCommercial, type CommissionRuleInput } from "@/lib/offer-commercial";
import { foldOffer } from "@/lib/offer-name";
import { whatsappClickHref } from "@/lib/whatsapp-link";

/** Rows Inicio shows in «Tu lista de hoy». */
export const INICIO_LIST_SIZE = 5;

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function weekdayOf(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** «Domingo 4 de octubre», in Bogotá. */
export function bogotaDateLine(now = new Date(), timeZone = CRM_TIMEZONE) {
  const key = zonedDayKey(now, timeZone);
  const [, month, day] = key.split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(key)]} ${day} de ${MONTHS[month - 1]}`;
}

/** «octubre». */
export function bogotaMonthName(now = new Date(), timeZone = CRM_TIMEZONE) {
  return MONTHS[zonedParts(now, timeZone).month - 1];
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export type GoalProgress = {
  llevasUsd: number;
  metaUsd: number | null;
  /** Whole percent, can pass 100. Null without a goal. */
  pct: number | null;
  /** Bar width, 0 to 100. */
  barPct: number;
  /** Calendar days after today until the month ends. */
  daysLeft: number;
  daysLabel: string;
};

/** «Quedan 27 días» counts the days after today, so the last day says it plainly. */
export function daysLeftLabel(daysLeft: number) {
  if (daysLeft <= 0) return "Hoy es el último día del mes";
  if (daysLeft === 1) return "Queda 1 día";
  return `Quedan ${daysLeft} días`;
}

export function goalProgress(args: {
  llevasUsd: number;
  metaUsd: number | null | undefined;
  now?: Date;
}): GoalProgress {
  const parts = zonedParts(args.now || new Date());
  const daysLeft = Math.max(0, lastDayOfMonth(parts.year, parts.month) - parts.day);
  const llevas = Math.max(0, Math.round(args.llevasUsd || 0));
  const meta = args.metaUsd && args.metaUsd > 0 ? Math.round(args.metaUsd) : null;
  const pct = meta ? Math.floor((llevas / meta) * 100) : null;
  return {
    llevasUsd: llevas,
    metaUsd: meta,
    pct,
    barPct: pct == null ? 0 : Math.min(100, Math.max(0, pct)),
    daysLeft,
    daysLabel: daysLeftLabel(daysLeft),
  };
}

/** Commission rows already loaded by the dashboard, dated in this Bogotá month. */
export function monthCommissionUsd(
  rows: { fecha: string | Date; generada: number }[],
  now = new Date(),
) {
  const month = zonedDayKey(now).slice(0, 7);
  return rows.reduce((sum, row) => {
    const at = row.fecha instanceof Date ? row.fecha : new Date(row.fecha);
    if (zonedDayKey(at).slice(0, 7) !== month) return sum;
    return sum + (Number.isFinite(row.generada) ? Math.max(0, row.generada) : 0);
  }, 0);
}

export type ChipTone = "today" | "late" | "future";
export type FollowupChip = { tone: ChipTone; label: string };

/** «3:00 pm», «10:00 am». */
export function clockLabel(hour: number, minute: number) {
  const suffix = hour >= 12 ? "pm" : "am";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** Only an hour the closer wrote («2026-10-07 15:00»). A bare day or 00:00 has no hour. */
export function stampClock(proximo: string | null | undefined) {
  const match = String(proximo || "").trim().match(/^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return "";
  if (hour === 0 && minute === 0) return "";
  return clockLabel(hour, minute);
}

/** The Bogotá day of a follow-up: the written próximo first, then the alert instant. */
export function followupDay(row: { proximo?: string | null; dueAt?: string | null }) {
  const written = dueDayFromProximo(row.proximo);
  if (written) return written;
  const at = new Date(String(row.dueAt || ""));
  return Number.isNaN(at.getTime()) ? "" : zonedDayKey(at);
}

/** Amber for today, rose for days without an answer, grey for later. Never «vencido». */
export function followupChip(
  row: { proximo?: string | null; dueAt?: string | null },
  now = new Date(),
): FollowupChip {
  const today = zonedDayKey(now);
  const day = followupDay(row) || today;
  const diff = calendarDaysBetween(day, today);
  const clock = stampClock(row.proximo);
  if (diff < 0) {
    const late = -diff;
    return {
      tone: "late",
      label: late === 1 ? "Hace 1 día sin respuesta" : `Hace ${late} días sin respuesta`,
    };
  }
  if (diff === 0) return { tone: "today", label: clock ? `Hoy ${clock}` : "Hoy" };
  const [, month, date] = day.split("-").map(Number);
  const dayName = diff === 1 ? "Mañana" : `${WEEKDAYS[weekdayOf(day)]} ${date} ${MONTHS_SHORT[month - 1]}`;
  return { tone: "future", label: clock ? `${dayName} ${clock}` : dayName };
}

export type InicioFollowupSource = {
  id: string;
  leadId?: string;
  cliente: string;
  oferta?: string | null;
  telefono?: string | null;
  dueAt: string;
  proximo?: string;
  estado?: string;
  enJuego?: number;
  tipo?: string;
  hilo?: string;
  /** The agreement written on the follow-up's call (Operación «Acuerdo»). */
  callAcuerdo?: string;
  acuerdo?: string;
  proximaAccion?: string;
  queHacer?: string;
  contexto?: string;
  mensajeSugerido?: string;
  closesOnHecho?: boolean;
};

export type InicioRow = {
  id: string;
  name: string;
  initials: string;
  offer: string;
  step: string;
  chip: FollowupChip;
  /** Commission on the money at stake. Null when the offer has no commission rule or nothing is at stake. */
  commissionUsd: number | null;
  phone: string;
  whatsappHref: string;
  closesOnHecho: boolean;
};

export type InicioList = {
  rows: InicioRow[];
  /** Open follow-ups not shown in the five. */
  more: number;
  total: number;
};

export function initialsOf(name: string) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word.charAt(0).toLocaleUpperCase("es"));
  return letters.join("") || "?";
}

const TIMING_TAIL = /\s*·\s*(vencido|pendiente de hoy)\s*$/i;

function sentence(text: string) {
  const clean = text.replace(TIMING_TAIL, "").replace(/\s+/g, " ").trim();
  if (!clean || /vencid/i.test(clean)) return "";
  return clean.charAt(0).toLocaleUpperCase("es") + clean.slice(1);
}

/** «Qué quedó»: the call's agreement, then the stored one, then the next step. Never the timing word. */
export function nextStepText(row: InicioFollowupSource) {
  for (const candidate of [row.callAcuerdo, row.acuerdo, row.proximaAccion, row.queHacer, row.contexto]) {
    const text = sentence(String(candidate || ""));
    if (text && !/^seguimientos?$/i.test(text)) return text;
  }
  return "Retomar el contacto";
}

/**
 * Same order as «¿A quién llamo hoy?» (prioritizeDesk: money, then days late, then stage)
 * for today and late rows. Later dates follow, soonest first.
 */
export function rankFollowups<T extends InicioFollowupSource>(rows: T[], now = new Date()) {
  const today = zonedDayKey(now);
  const due: { line: DeskLine; row: T }[] = [];
  const later: { day: string; row: T }[] = [];
  for (const row of rows) {
    if (!String(row.cliente || "").trim()) continue;
    const day = followupDay(row) || today;
    const diff = calendarDaysBetween(day, today);
    if (diff > 0) {
      later.push({ day, row });
      continue;
    }
    due.push({
      row,
      line: {
        name: row.cliente.trim(),
        step: String(row.hilo || row.tipo || ""),
        date: day,
        estado: diff < 0 ? "VENCIDO" : "HOY",
        amount: row.enJuego || 0,
        lateDays: diff < 0 ? -diff : 0,
        reason: "",
        kind: (row.enJuego || 0) > 0 ? "cobro" : "llamada",
      },
    });
  }
  const order = prioritizeDesk(due.map((item) => item.line));
  const dueRanked = order.map((line) => due.find((item) => item.line === line)!.row);
  const laterRanked = later
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        (b.row.enJuego || 0) - (a.row.enJuego || 0) ||
        stageHeat(String(b.row.hilo || b.row.tipo || "")) - stageHeat(String(a.row.hilo || a.row.tipo || "")) ||
        a.row.cliente.localeCompare(b.row.cliente, "es"),
    )
    .map((item) => item.row);
  return [...dueRanked, ...laterRanked];
}

export type OfferRule = { productName: string; aliases: string[]; rule: CommissionRuleInput | null };

export function offerRules(rows: { productName: string; commercial: unknown }[]): OfferRule[] {
  return rows
    .filter((row) => String(row.productName || "").trim())
    .map((row) => {
      const commercial = parseCommercial(row.commercial);
      return { productName: row.productName, aliases: commercial.aliases, rule: commercial.commission };
    });
}

function ruleFor(offer: string | null | undefined, rules: OfferRule[]) {
  const needle = foldOffer(String(offer || ""));
  if (!needle) return null;
  const hit = rules.find((row) =>
    [row.productName, ...row.aliases].some((name) => foldOffer(name) === needle),
  );
  return hit?.rule || null;
}

/** Commission on the open money, only with the offer's own rule. No rule or no money: null. */
export function rowCommissionUsd(args: {
  enJuego: number | null | undefined;
  offer: string | null | undefined;
  rules: OfferRule[];
  mesCash?: number;
}) {
  const amount = Number(args.enJuego || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const rule = ruleFor(args.offer, args.rules);
  if (!rule || resolveCommissionPct(rule, null) <= 0) return null;
  const generada = commissionOnAmount({ rule, accumulatedBefore: args.mesCash || 0, amount }).generada;
  const rounded = Math.round(generada);
  return rounded > 0 ? rounded : null;
}

export function buildInicioList(args: {
  followups: InicioFollowupSource[];
  rules: OfferRule[];
  mesCash?: number;
  now?: Date;
  limit?: number;
}): InicioList {
  const ranked = rankFollowups(args.followups, args.now);
  const limit = args.limit ?? INICIO_LIST_SIZE;
  const rows = ranked.slice(0, limit).map((row) => {
    const phone = String(row.telefono || "").trim();
    return {
      id: row.id,
      name: row.cliente.trim(),
      initials: initialsOf(row.cliente),
      offer: String(row.oferta || "").trim(),
      step: nextStepText(row),
      chip: followupChip(row, args.now),
      commissionUsd: rowCommissionUsd({
        enJuego: row.enJuego,
        offer: row.oferta,
        rules: args.rules,
        mesCash: args.mesCash,
      }),
      phone,
      whatsappHref: phone ? whatsappClickHref(phone, String(row.mensajeSugerido || "").trim()) : "",
      closesOnHecho: row.closesOnHecho !== false,
    };
  });
  return { rows, more: Math.max(0, ranked.length - rows.length), total: ranked.length };
}

export type LastClose = { days: number; callsSince: number };

/** Newest «CIERRE VENTA» call and the real calls after it. Nothing closed: null. */
export function lastCloseInfo(
  rows: { id: string; fecha: string | null; estadoAgenda?: string; interna?: boolean }[],
  now = new Date(),
): LastClose | null {
  const today = zonedDayKey(now);
  const calls = rows.filter(
    (row) =>
      !row.interna &&
      !String(row.id).startsWith("lead:") &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(row.fecha || "")) &&
      String(row.fecha) <= today &&
      String(row.estadoAgenda || "").toUpperCase() !== "AGENDADO",
  );
  const closes = calls
    .filter((row) => String(row.estadoAgenda || "").toUpperCase() === "CIERRE VENTA")
    .map((row) => String(row.fecha))
    .sort();
  const last = closes[closes.length - 1];
  if (!last) return null;
  return {
    days: Math.max(0, -calendarDaysBetween(last, today)),
    callsSince: calls.filter((row) => String(row.fecha) > last).length,
  };
}

export function lastCloseLabel(info: LastClose) {
  const when = info.days === 0 ? "hoy" : info.days === 1 ? "hace 1 día" : `hace ${info.days} días`;
  const calls =
    info.callsSince === 1 ? "1 llamada desde entonces" : `${info.callsSince} llamadas desde entonces`;
  return { when: `Último cierre: ${when}`, calls };
}

export type ParaLlegar = {
  /** «Te faltan 2 cierres de Círculo Millonario». Empty when it cannot be computed. */
  headline: string;
  /** «Con tu tasa actual son ≈ 8 reuniones». Empty with assumed rates. */
  meetings: string;
  lastClose: LastClose | null;
  /** «Último cierre: hace 6 días» and «7 llamadas desde entonces», or empty. */
  closeWhen: string;
  closeCalls: string;
};

/** Lines for «Para llegar». A line that is not backed by real numbers stays empty. */
export function paraLlegarLines(args: {
  llevasUsd: number;
  metaUsd: number | null;
  offerName: string;
  projection: {
    falta: number;
    cierres: number;
    shows: number;
    usedAssumedRates: boolean;
    rates?: { pct: number };
  } | null;
  lastClose: LastClose | null;
}): ParaLlegar {
  const { projection } = args;
  let headline = "";
  let meetings = "";
  if (args.metaUsd && args.llevasUsd >= args.metaUsd) {
    headline = "Ya llegaste a tu meta de este mes";
  } else if (projection && args.metaUsd) {
    if (projection.falta <= 0) {
      headline = "Te alcanza con cobrar lo que ya está pendiente";
    } else if (projection.cierres > 0 && (projection.rates?.pct ?? 1) > 0) {
      const offer = args.offerName.trim();
      const count = projection.cierres === 1 ? "1 cierre" : `${projection.cierres} cierres`;
      headline = offer ? `Te faltan ${count} de ${offer}` : `Te faltan ${count}`;
      if (!projection.usedAssumedRates && projection.shows > 0) {
        meetings = `Con tu tasa actual son ≈ ${projection.shows} ${projection.shows === 1 ? "reunión" : "reuniones"}`;
      }
    }
  }
  const close = args.lastClose ? lastCloseLabel(args.lastClose) : null;
  return {
    headline,
    meetings,
    lastClose: args.lastClose,
    closeWhen: close?.when || "",
    closeCalls: close?.calls || "",
  };
}

export type InicioBlock = {
  dateLine: string;
  monthName: string;
  goal: GoalProgress;
  paraLlegar: ParaLlegar;
  list: InicioList;
  porConfirmar: number;
};
