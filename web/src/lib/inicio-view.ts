import { commissionOnAmount, resolveCommissionPct } from "@/lib/commission";
import {
  compareFollowupRank,
  followupCalendarDay,
  followupRankInput,
  openFollowupCountOf,
  pickOpenByName,
} from "@/lib/crm-followups";
import { calendarDaysBetween, CRM_TIMEZONE, zonedDayKey, zonedParts } from "@/lib/crm-time";
import { parseCommercial, type CommissionRuleInput } from "@/lib/offer-commercial";
import { fillFollowupGuion, type FollowupVars } from "@/lib/followup-scripts";
import { foldOffer } from "@/lib/offer-name";
import { plainStatus } from "@/lib/plain-labels";
import { dropDanglingWords } from "@/lib/visible-text";
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
  return followupCalendarDay(row);
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

/**
 * The sheet's «cuándo». A future or today date is the next step, with the hour
 * only when the closer wrote one. A past day is «Pendiente desde», not a new cita.
 */
export function followupWhenParts(
  row: { proximo?: string | null; dueAt?: string | null },
  now = new Date(),
): { date: string; age: string } {
  const today = zonedDayKey(now);
  const day = followupDay(row);
  if (!day) return { date: "", age: "" };
  const diff = calendarDaysBetween(day, today);
  const clock = stampClock(row.proximo);
  const [year, month, date] = day.split("-").map(Number);
  const short = `${date} ${MONTHS_SHORT[month - 1] || ""}`.trim();
  const dated = year && String(year) !== today.slice(0, 4) ? `${short} ${year}` : short;
  if (diff < 0) {
    const late = -diff;
    const pending = clock ? `Pendiente desde el ${dated}, ${clock}` : `Pendiente desde el ${dated}`;
    return {
      date: pending,
      age: late === 1 ? "Hace 1 día sin respuesta" : `Hace ${late} días sin respuesta`,
    };
  }
  if (diff === 0) return { date: clock ? `Hoy ${clock}` : "Hoy", age: "" };
  if (diff === 1) return { date: clock ? `Mañana ${clock}` : "Mañana", age: "" };
  const dayName = `${WEEKDAYS[weekdayOf(day)]} ${dated}`;
  return { date: clock ? `${dayName} ${clock}` : dayName, age: "" };
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
  /** Lead.nextStep when the call did not write an agreement. */
  leadNextStep?: string;
  /** Words on proximo_seguimiento that are not just a date. */
  proximoNote?: string;
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
  /** Commission. Null when neither the money talked nor the offer price can support it. */
  commissionUsd: number | null;
  /** «comisión» on money already talked, «comisión si cierra» from the offer price. */
  commissionLabel: string;
  phone: string;
  whatsappHref: string;
  closesOnHecho: boolean;
  messages: string[];
  material: string[];
  agreement: string;
  whenLabel: string;
  /** Readable date of the follow-up («23 sep», «Hoy 3:00 pm»). Empty when there is no day. */
  whenDate: string;
  /** «Hace N días sin respuesta» when that day is already past. Empty otherwise. */
  whenAge: string;
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

const TIMING_TAIL = /\s*·\s*(vencido|atrasado|pendiente de hoy|hace \d+ d[ií]as sin respuesta)\s*$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const EMPTY_OFFER = /^(—|-|sin oferta|sin producto|null|n\/a|na|otros)$/i;

function sentence(text: string) {
  const clean = text
    .replace(TIMING_TAIL, "")
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim();
  if (!clean || /vencid/i.test(clean) || DATE_ONLY.test(clean)) return "";
  if (/^seguimientos?$/i.test(clean) || /^retomar el contacto$/i.test(clean)) return "";
  return clean.charAt(0).toLocaleUpperCase("es") + clean.slice(1);
}

/** Cut on a word. No «..» and no ellipsis glued to a dangling word. */
export function cutAtWord(value: string, max = 140) {
  const clean = value.replace(/\s+/g, " ").replace(/\.{2,}/g, ".").trim();
  if (!clean || clean.length <= max) return clean;
  let cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  if (space >= 24) cut = cut.slice(0, space);
  return dropDanglingWords(cut).replace(/[.,;:]+$/g, "").replace(/\.{2,}/g, "").trim();
}

function followupKind(row: InicioFollowupSource) {
  const labeled = plainStatus(String(row.hilo || row.tipo || ""));
  if (!labeled || labeled === "—") return "Seguimiento";
  return labeled;
}

/** «Pendiente desde el 23 sep» when the only stored step is a bare stage word. */
export function pendingFromPhrase(row: InicioFollowupSource, now = new Date()) {
  const day = followupDay(row);
  if (!day) return "";
  const today = zonedDayKey(now);
  const diff = calendarDaysBetween(day, today);
  const [, month, date] = day.split("-").map(Number);
  const short = `${date} ${MONTHS_SHORT[month - 1] || ""}`.trim();
  const kind = followupKind(row);
  const clock = stampClock(row.proximo);
  if (diff < 0) return `${kind} pendiente desde el ${short}`;
  if (diff === 0) return clock ? `${kind} pendiente hoy a las ${clock}` : `${kind} pendiente hoy`;
  if (diff === 1) return clock ? `${kind} mañana a las ${clock}` : `${kind} mañana`;
  return clock ? `${kind} el ${short} a las ${clock}` : `${kind} el ${short}`;
}

/** «Qué quedó»: the call agreement, the lead's next step, then a concrete action. A dated follow-up beats the generic line. */
export function nextStepText(row: InicioFollowupSource, now = new Date()) {
  for (const candidate of [
    row.callAcuerdo,
    row.acuerdo,
    row.leadNextStep,
    row.proximaAccion,
    row.queHacer,
    row.contexto,
    row.proximoNote,
  ]) {
    const text = sentence(String(candidate || ""));
    if (text) return cutAtWord(text);
  }
  return pendingFromPhrase(row, now) || "Retomar el contacto";
}

/** Subtitle of «Tu lista de hoy». Without a goal it does not mention the goal. */
export function listSubtitle(hasGoal: boolean) {
  return hasGoal
    ? "Primero lo que más te acerca a la meta"
    : "Primero lo más urgente y con más dinero en juego";
}

export function shownOffer(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || EMPTY_OFFER.test(text)) return "";
  return text;
}

/**
 * Same order as «¿A quién llamo hoy?» (compareFollowupRank), including the tie-break.
 * Due rows first. Later dates follow, soonest first.
 */
export function rankFollowups<T extends InicioFollowupSource>(rows: T[], now = new Date()) {
  const open = pickOpenByName(
    rows.map((row) => ({
      ...row,
      name: String(row.cliente || ""),
      due: followupDay(row),
      closed: false,
    })),
  );
  return [...open].sort((a, b) => compareFollowupRank(followupRankInput(a, now), followupRankInput(b, now)));
}

export type OfferScript = { guion: string; canal?: string; type?: string; asset?: string };

export type OfferRule = {
  productName: string;
  aliases: string[];
  rule: CommissionRuleInput | null;
  listPrice: number | null;
  scripts: OfferScript[];
};

export function offerRules(rows: { productName: string; commercial: unknown }[]): OfferRule[] {
  return rows
    .filter((row) => String(row.productName || "").trim())
    .map((row) => {
      const commercial = parseCommercial(row.commercial);
      const price = Number(commercial.listPrice);
      return {
        productName: row.productName,
        aliases: commercial.aliases,
        rule: commercial.commission,
        listPrice: Number.isFinite(price) && price > 0 ? price : null,
        scripts: (commercial.scripts || [])
          .map((script) => ({
            guion: String(script.guion || "").trim(),
            canal: script.canal,
            type: script.type,
            asset: String(script.asset || "").trim(),
          }))
          .filter((script) => script.guion || script.asset),
      };
    });
}

function offerHit(offer: string | null | undefined, rules: OfferRule[]) {
  const needle = foldOffer(String(offer || ""));
  if (!needle) return null;
  return (
    rules.find((row) => [row.productName, ...row.aliases].some((name) => foldOffer(name) === needle)) ||
    null
  );
}

export type CommissionShow = { usd: number; label: "comisión" | "comisión si cierra" };

function commissionUsd(rule: CommissionRuleInput, amount: number, mesCash: number) {
  if (resolveCommissionPct(rule, null) <= 0 || amount <= 0) return 0;
  const generada = commissionOnAmount({ rule, accumulatedBefore: mesCash, amount }).generada;
  const rounded = Math.round(generada);
  return rounded > 0 ? rounded : 0;
}

/**
 * Money already talked uses the offer rule («comisión»).
 * No amount, but a known price and a rule: «comisión si cierra».
 * Neither: hide the slot.
 */
export function rowCommission(args: {
  enJuego: number | null | undefined;
  offer: string | null | undefined;
  rules: OfferRule[];
  mesCash?: number;
}): CommissionShow | null {
  const hit = offerHit(args.offer, args.rules);
  if (!hit?.rule) return null;
  const mesCash = args.mesCash || 0;
  const talked = Number(args.enJuego || 0);
  if (Number.isFinite(talked) && talked > 0) {
    const usd = commissionUsd(hit.rule, talked, mesCash);
    return usd > 0 ? { usd, label: "comisión" } : null;
  }
  if (!hit.listPrice) return null;
  const usd = commissionUsd(hit.rule, hit.listPrice, mesCash);
  return usd > 0 ? { usd, label: "comisión si cierra" } : null;
}

/** @deprecated Prefer rowCommission, which also distinguishes the label. */
export function rowCommissionUsd(args: {
  enJuego: number | null | undefined;
  offer: string | null | undefined;
  rules: OfferRule[];
  mesCash?: number;
}) {
  const talked = Number(args.enJuego || 0);
  if (!Number.isFinite(talked) || talked <= 0) return null;
  return rowCommission(args)?.usd ?? null;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name.trim();
}

function scriptVars(name: string, offer: string): FollowupVars {
  return {
    nombre: firstName(name),
    programa: offer,
    monto: "",
    saldo: "",
    fecha: "",
    pago: "",
    objecion: "",
    deseo: "",
    closer: "",
  };
}

function usableMessage(value: string) {
  const text = value.replace(/[ \t]+/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 12) return "";
  if (/\[[^\]\n]{1,80}\]/.test(text)) return "";
  if (/USD(?!\s*\d)/i.test(text)) return "";
  if (/\(\s*\)/.test(text)) return "";
  return text;
}

const THIRD_PERSON = /\b(el|la|los|las)\s+(cliente|clienta|lead|prospecto)s?\b/i;

function foldEs(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * A stored third-person note, rewritten only when the meaning is already in the sentence.
 * Anything else stays, so we don't invent a fact.
 */
export function closerFacingNote(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || !THIRD_PERSON.test(text)) return text;
  const folded = foldEs(text);
  if (/evalu/.test(folded) && /propuest/.test(folded)) return "Quedó en revisar la propuesta y dar una respuesta.";
  if (/propuest/.test(folded) && /(respuest|decisi)/.test(folded)) return "Quedó en responder sobre la propuesta.";
  if (/contador/.test(folded)) return "Quedó en revisarlo con su contador.";
  if (/espos|pareja/.test(folded)) return "Quedó en hablarlo con su pareja.";
  if (/\bsocio\b/.test(folded)) return "Quedó en hablarlo con su socio.";
  if (/cuota|\bcobr|\bpago\b/.test(folded)) return "Quedó en seguir con el pago.";
  if (/decisi/.test(folded)) return "Quedó en tomar una decisión.";
  if (/reuni/.test(folded)) return "Quedó en confirmar la reunión.";
  return text;
}

/** A note about «el cliente» is not something you paste into their WhatsApp. */
function messageToLead(value: string) {
  const text = usableMessage(value);
  if (!text || THIRD_PERSON.test(text)) return "";
  return text;
}

/**
 * What you can say to the person. A third-person CRM note becomes a short tú line,
 * or nothing when we would only be talking about them.
 */
export function secondPersonCue(step: string) {
  const text = step.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (!THIRD_PERSON.test(text)) return quotableStep(text);
  const folded = foldEs(text);
  if (/evalu/.test(folded) && /propuest/.test(folded)) return "¿ya revisaste la propuesta?";
  if (/propuest/.test(folded) && /(respuest|decisi)/.test(folded)) return "¿ya tienes una respuesta?";
  if (/contador/.test(folded)) return "¿lo revisaste con tu contador?";
  if (/espos|pareja/.test(folded)) return "¿lo hablaste con tu pareja?";
  if (/\bsocio\b/.test(folded)) return "¿lo hablaste con tu socio?";
  if (/cuota|\bcobr|\bpago\b/.test(folded)) return "¿seguimos con el pago?";
  if (/decisi/.test(folded)) return "¿ya tienes una decisión?";
  if (/reuni/.test(folded)) return "¿confirmamos la reunión?";
  return "";
}

/** A stored agreement the closer can quote. A stage word or a pending-from line is not one. */
export function quotableStep(step: string) {
  const text = step.replace(/\s+/g, " ").trim();
  if (!text || /^retomar el contacto$/i.test(text)) return "";
  if (/\bpendiente desde\b/i.test(text)) return "";
  if (/\bpendiente hoy\b/i.test(text)) return "";
  if (/^(seguimiento|decisi[oó]n|cobro|retomar|reuni[oó]n)\b/i.test(text) && text.length < 48) return "";
  return text;
}

/** «¿ya…» after a period becomes «¿Ya…». The mark itself does not count as the capital. */
function capitalizeLead(value: string) {
  return value.replace(/^(¿|¡)?(\p{L})/u, (_, mark: string, letter: string) => {
    return `${mark || ""}${letter.toLocaleUpperCase("es")}`;
  });
}

/** Short follow-ups from the real name, offer and agreement. No phone, price or quote we don't have. */
export function derivedFollowupMessages(args: { name: string; offer: string; step: string; when?: string }) {
  const who = firstName(args.name);
  const hi = who ? `Hola ${who}` : "Hola";
  const offer = shownOffer(args.offer);
  const step = secondPersonCue(args.step);
  const clock =
    args.when && !/sin respuesta/i.test(args.when) && /\d/.test(args.when) ? args.when.trim() : "";
  const lines: string[] = [];
  const lower = (value: string) => value.charAt(0).toLocaleLowerCase("es") + value.slice(1).replace(/\.+$/, "");
  if (step.startsWith("¿")) {
    lines.push(`${hi}, ${step}`);
    lines.push(`${hi}, te escribo para saber cómo vas. ${capitalizeLead(step)}`);
  } else if (step) {
    lines.push(`${hi}, te escribo por lo que quedamos: ${lower(step)}. ¿Seguimos?`);
    lines.push(`${hi}, ¿cómo vas con esto? ${capitalizeLead(step)}`);
  }
  if (offer) {
    lines.push(
      step
        ? `${hi}, ¿seguimos con ${offer}? Quedó pendiente ${lower(step)}.`
        : `${hi}, ¿seguimos con ${offer}?`,
    );
  }
  if (clock) lines.push(`${hi}, ¿seguimos ${lower(clock)}?`);
  if (lines.length < 2) {
    lines.push(`${hi}, te escribo para retomar el contacto. ¿Seguimos?`);
    lines.push(who ? `${who}, ¿retomamos el contacto?` : `${hi}, ¿retomamos el contacto?`);
  }
  const unique: string[] = [];
  for (const line of lines) {
    const text = usableMessage(line);
    if (!text || unique.includes(text)) continue;
    unique.push(text);
    if (unique.length >= 3) break;
  }
  return unique;
}

/** Up to three WhatsApp lines: the stored message, the offer's own scripts, then lines from the agreement. */
export function messageIdeas(args: {
  name: string;
  offer: string;
  suggested?: string;
  scripts: OfferScript[];
  step?: string;
  when?: string;
  tipo?: string;
}) {
  const ideas: string[] = [];
  const push = (value: string) => {
    const text = usableMessage(value);
    if (!text || ideas.some((item) => item.replace(/\s+/g, " ") === text.replace(/\s+/g, " "))) return;
    ideas.push(text);
  };
  push(messageToLead(String(args.suggested || "")));
  const offer = shownOffer(args.offer);
  const vars = scriptVars(args.name, offer);
  const want = String(args.tipo || "").trim().toUpperCase();
  const whatsapp = args.scripts.filter((script) => script.guion && (!script.canal || script.canal === "WHATSAPP"));
  const ordered = [
    ...whatsapp.filter((script) => want && String(script.type || "").toUpperCase() === want),
    ...whatsapp.filter((script) => !want || String(script.type || "").toUpperCase() !== want),
  ];
  for (const script of ordered) {
    push(fillFollowupGuion(script.guion, vars));
    if (ideas.length >= 3) break;
  }
  if (ideas.length < 2) {
    for (const line of derivedFollowupMessages({
      name: args.name,
      offer,
      step: args.step || "",
      when: args.when,
    })) {
      push(line);
      if (ideas.length >= 3) break;
    }
  }
  return ideas.slice(0, 3);
}

export type SheetBlocks = {
  agreement: string;
  nextStep: string;
  /** Explicit date. Hidden when empty. */
  when: string;
  /** «Hace N días sin respuesta», only when that age exists. */
  age?: string;
  messages: string[];
  material: string[];
  phone: string;
};

/** Hide a block when its real data is missing. */
export function sheetBlocks(args: SheetBlocks): SheetBlocks {
  const agreement = closerFacingNote(args.agreement.trim());
  const nextStep = closerFacingNote(args.nextStep.trim());
  const when = args.when.trim();
  const age = String(args.age || "").trim();
  const generic = /^retomar el contacto$/i.test(nextStep);
  const step = !nextStep || generic || nextStep === agreement ? "" : nextStep;
  return {
    agreement,
    nextStep: step,
    when,
    age: age && age !== when ? age : "",
    messages: args.messages.map((item) => item.trim()).filter(Boolean).slice(0, 3),
    material: args.material.map((item) => item.trim()).filter(Boolean),
    phone: args.phone.trim(),
  };
}

export function buildInicioList(args: {
  followups: InicioFollowupSource[];
  rules: OfferRule[];
  mesCash?: number;
  now?: Date;
  limit?: number;
  /** Confirmed closes already loaded. Name + offer, nothing invented. */
  successes?: { name: string; offer: string }[];
}): InicioList {
  const ranked = rankFollowups(args.followups, args.now);
  const limit = args.limit ?? INICIO_LIST_SIZE;
  const rows = ranked.slice(0, limit).map((row) => {
    const phone = String(row.telefono || "").trim();
    const offer = shownOffer(row.oferta);
    const stepSource = nextStepText(row, args.now);
    const step = closerFacingNote(stepSource);
    const chip = followupChip(row, args.now);
    const whenParts = followupWhenParts(row, args.now);
    const commission = rowCommission({
      enJuego: row.enJuego,
      offer,
      rules: args.rules,
      mesCash: args.mesCash,
    });
    const scripts = offerHit(offer, args.rules)?.scripts || [];
    const messages = messageIdeas({
      name: row.cliente,
      offer,
      suggested: row.mensajeSugerido,
      scripts,
      step: stepSource,
      when: chip.label,
      tipo: String(row.hilo || row.tipo || ""),
    });
    const cases = (args.successes || [])
      .filter((item) => offer && foldOffer(item.offer) === foldOffer(offer) && item.name.trim())
      .filter((item) => foldOffer(item.name) !== foldOffer(row.cliente))
      .slice(0, 3)
      .map((item) => `${item.name.trim()} ya cerró ${offer}`);
    const assets = scripts.map((script) => String(script.asset || "").trim()).filter(Boolean);
    const material = [...cases, ...assets].filter((item, index, all) => all.indexOf(item) === index).slice(0, 4);
    const agreement = closerFacingNote(
      sentence(String(row.callAcuerdo || row.acuerdo || row.leadNextStep || "")),
    );
    return {
      id: row.id,
      name: row.cliente.trim(),
      initials: initialsOf(row.cliente),
      offer,
      step,
      chip,
      commissionUsd: commission?.usd ?? null,
      commissionLabel: commission?.label || "",
      phone,
      whatsappHref: phone ? whatsappClickHref(phone, messages[0] || "") : "",
      closesOnHecho: row.closesOnHecho !== false,
      messages,
      material,
      agreement: agreement ? cutAtWord(agreement, 180) : "",
      whenLabel: chip.label,
      whenDate: whenParts.date,
      whenAge: whenParts.age,
    };
  });
  return { rows, more: Math.max(0, ranked.length - rows.length), total: ranked.length };
}

export type StartSteps = {
  show: boolean;
  goalDone: boolean;
  offerDone: boolean;
  callDone: boolean;
};

/**
 * «Empieza en 3 pasos» when there is no monthly goal and there is no lista de hoy.
 * If offers and follow-ups already exist, only the goal is missing: keep «Ponte una meta».
 */
export function startSteps(args: {
  hasGoal: boolean;
  openFollowups: number;
  offersLoaded: boolean;
  hasCalls: boolean;
}): StartSteps {
  const goalDone = args.hasGoal;
  const offerDone = args.offersLoaded;
  const callDone = args.hasCalls;
  const hasList = args.openFollowups > 0;
  const onlyGoalMissing = !goalDone && offerDone && hasList;
  return {
    show: !goalDone && !hasList && !onlyGoalMissing,
    goalDone,
    offerDone,
    callDone,
  };
}

/** Same count Inicio, the CRM panel and the chat must share. */
export function inicioOpenCount(rows: InicioFollowupSource[]) {
  return openFollowupCountOf(
    rows.map((row) => ({
      cliente: row.cliente,
      proximo: followupDay(row),
      closed: false,
    })),
  );
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
  onboarding: StartSteps;
};
