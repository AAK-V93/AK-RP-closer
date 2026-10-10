import {
  compareFollowupRank,
  foldLeadName,
  followupCalendarDay,
  followupRankInput,
  pickOpenByName,
} from "@/lib/crm-followups";
import { calendarDaysBetween, zonedDayKey, zonedMonthRange } from "@/lib/crm-time";
import { closerFacingNote, followupChip, initialsOf, nextStepText, shownOffer, type FollowupChip } from "@/lib/inicio-view";
import { periodOutcomes, type OutcomeCall } from "@/lib/outcome-counts";

/** «A quién contactar hoy» stays a short list. The rest is «Ver más». */
export const CRM_HOY_CAP = 7;

/** People still hidden in the hoy list. Not the open seguimiento total. */
export function hoyMoreCount(hoyLength: number, cap = CRM_HOY_CAP) {
  const count = Math.max(0, Math.trunc(Number(hoyLength) || 0));
  return Math.max(0, count - cap);
}

export type CrmBoardBucket = "cerrados" | "seguimiento" | "perdidos";
export type CrmBoardPeriod = "mes" | "anterior" | "todo";

export type CrmBoardCall = {
  id: string;
  leadId?: string;
  cliente: string;
  oferta?: string;
  producto?: string;
  fecha?: string | null;
  fechaProximo?: string;
  estadoAgenda?: string;
  leadStatus?: string;
  venta?: number | null;
  cash?: number | null;
  saldo?: number | null;
  modoPago?: string;
  interna?: boolean;
  seguimientoResultado?: string;
  razonNoCierre?: string;
  /** Stored call note. Used when the agreement is empty. Never invented. */
  notas?: string;
};

export type CrmBoardFollowup = {
  id: string;
  leadId?: string;
  cliente: string;
  dueAt?: string;
  proximo?: string;
  hilo?: string;
  tipo?: string;
  enJuego?: number;
  oferta?: string;
  leadStatus?: string;
  acuerdo?: string;
  proximaAccion?: string;
};

export type CrmBoardPerson = {
  id: string;
  /** Who the ficha opens. Empty when the person only exists on a call. */
  leadId: string;
  /** Latest call of the person, for the ficha when there is no lead. */
  callId: string;
  /** Open follow-up, so «Hecho» works from the ficha. */
  alertId: string;
  name: string;
  initials: string;
  offer: string;
  pago: string;
  pagoNote: string;
  /** Where it was left, the same sentence Inicio shows. Empty when we only have the chip. */
  leftOff: string;
  chip: FollowupChip | null;
  bucket: CrmBoardBucket;
  /** Question the row writes into the chat. */
  ask: string;
};

export type CrmBoard = {
  subtitle: string;
  hoy: CrmBoardPerson[];
  hoyNote: string;
  /** Cerrados and perdidos are null when that signal was never recorded («sin datos»). */
  counts: { cerrados: number | null; seguimiento: number; perdidos: number | null };
  rows: CrmBoardPerson[];
  shown: number;
  /** Null when the selected bucket has no recorded signal. */
  total: number | null;
  footer: string;
  empty: string;
  /** Heading for the people who are not already in «hoy». */
  restTitle: string;
};

const BUCKETS: CrmBoardBucket[] = ["cerrados", "seguimiento", "perdidos"];

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function matchesBoardOffer(value: string, selected: string) {
  if (!selected || selected === "todas") return true;
  const a = (value || "").toLowerCase();
  const b = selected.toLowerCase();
  return Boolean(a) && (a === b || a.includes(b) || b.includes(a));
}

/** Real money only. No invented cuota and no «USD 0». */
export function pagoLabel(
  call: Pick<CrmBoardCall, "cash" | "saldo" | "modoPago"> | undefined,
  money: (value: number) => string,
): { pago: string; note: string } {
  if (!call) return { pago: "", note: "" };
  const cash = Number(call.cash);
  const saldo = Number(call.saldo);
  const hasCash = Number.isFinite(cash) && cash > 0;
  const hasSaldo = Number.isFinite(saldo) && saldo > 0;
  const modo = fold(String(call.modoPago || ""));
  const modoNote = modo === "contado" || modo === "de contado" ? "de contado" : modo.includes("cuota") ? "en cuotas" : "";
  if (!hasCash && !hasSaldo) return { pago: "Sin pago", note: "" };
  if (hasCash && hasSaldo) return { pago: `Pagó ${money(cash)}`, note: `falta ${money(saldo)}` };
  if (hasCash) return { pago: `Pagó ${money(cash)}`, note: modoNote };
  return { pago: `Falta ${money(saldo)}`, note: modoNote };
}

function peoplePhrase(count: number, tail: string) {
  const head = count === 1 ? "1 persona" : `${count} personas`;
  return tail ? `${head} ${tail}` : head;
}

function latestCall(rows: CrmBoardCall[]) {
  return rows.reduce<CrmBoardCall | undefined>((best, row) => {
    if (!best) return row;
    const fecha = String(row.fecha || "");
    const prev = String(best.fecha || "");
    if (fecha > prev) return row;
    if (fecha === prev && row.id > best.id) return row;
    return best;
  }, undefined);
}

function askFor(name: string) {
  return `¿En qué quedé con ${name}?`;
}

/** The agreement Inicio prints on the row. A bare «Retomar el contacto» stays off the chip line. */
function leftOffOf(row: CrmBoardFollowup, call: CrmBoardCall | undefined, now: Date) {
  const step = closerFacingNote(
    nextStepText(
      {
        id: row.id,
        cliente: row.cliente,
        dueAt: row.dueAt || "",
        proximo: row.proximo,
        acuerdo: row.acuerdo,
        proximaAccion: row.proximaAccion,
        hilo: row.hilo,
        tipo: row.tipo,
        callNote: call?.notas,
      },
      now,
    ),
  );
  if (!step || /^retomar el contacto$/i.test(step)) return "";
  return step;
}

/**
 * Compact CRM. «En seguimiento» and «A quién contactar hoy» use the same
 * rank as Inicio (`compareFollowupRank`). Seguimiento is every open follow-up,
 * the same set Inicio counts. The month filter applies to cierres and perdidos.
 */
export function buildCrmBoard(args: {
  calls: CrmBoardCall[];
  followups: CrmBoardFollowup[];
  offer?: string;
  period?: CrmBoardPeriod;
  query?: string;
  bucket?: CrmBoardBucket;
  now?: Date;
  money?: (value: number) => string;
}): CrmBoard {
  const now = args.now || new Date();
  const today = zonedDayKey(now);
  const month = zonedMonthRange(now);
  const period = args.period || "mes";
  const bucket = args.bucket || "seguimiento";
  const offer = args.offer || "todas";
  const query = fold(args.query || "").trim();
  const money = args.money || ((value: number) => `USD ${Math.round(value)}`);

  const calls = args.calls.filter((row) => !row.interna && foldLeadName(row.cliente));
  const byName = new Map<string, CrmBoardCall[]>();
  for (const row of calls) {
    const key = foldLeadName(row.cliente);
    const list = byName.get(key) || [];
    list.push(row);
    byName.set(key, list);
  }

  const open = pickOpenByName(
    args.followups.map((row) => ({
      ...row,
      name: String(row.cliente || "").trim(),
      due: followupCalendarDay(row),
      closed: false,
    })),
  );
  const seguimiento = [...open].sort((a, b) =>
    compareFollowupRank(followupRankInput(a, now), followupRankInput(b, now)),
  );
  type Draft = {
    id: string;
    name: string;
    offer: string;
    call?: CrmBoardCall;
    followup?: CrmBoardFollowup;
    day: string;
    bucket: CrmBoardBucket;
    amount: number;
  };
  const drafts: Draft[] = [];

  for (const row of seguimiento) {
    const key = foldLeadName(row.name);
    const call = latestCall(byName.get(key) || []);
    drafts.push({
      id: row.id,
      name: row.name,
      offer: shownOffer(row.oferta) || shownOffer(call?.oferta) || shownOffer(call?.producto),
      call,
      followup: row,
      day: row.due,
      bucket: "seguimiento",
      amount: Number(row.enJuego) || 0,
    });
  }

  const callMatches = (row: CrmBoardCall) =>
    matchesBoardOffer(shownOffer(row.oferta) || shownOffer(row.producto), offer);
  const evidence: OutcomeCall[] = calls.filter(callMatches).map((row) => ({
    cliente: row.cliente,
    fecha: row.fecha,
    estadoAgenda: row.estadoAgenda,
    leadStatus: row.leadStatus,
    seguimientoResultado: row.seguimientoResultado,
    razonNoCierre: row.razonNoCierre,
  }));
  for (const row of args.followups) {
    if (!row.leadStatus || !matchesBoardOffer(shownOffer(row.oferta), offer)) continue;
    evidence.push({
      cliente: row.cliente,
      fecha: followupCalendarDay(row),
      leadStatus: row.leadStatus,
    });
  }
  const outcomes = periodOutcomes({ calls: evidence, period, now });
  const monthOutcomes = periodOutcomes({ calls: evidence, period: "mes", now });

  const pushOutcome = (key: string, bucket: "cerrados" | "perdidos") => {
    const rows = byName.get(key) || [];
    const call =
      bucket === "cerrados"
        ? latestCall(rows.filter((row) => String(row.estadoAgenda || "").toUpperCase() === "CIERRE VENTA")) ||
          latestCall(rows)
        : latestCall(rows);
    const followup = args.followups.find((row) => foldLeadName(row.cliente) === key);
    const name = (call?.cliente || followup?.cliente || "").trim();
    if (!name) return;
    drafts.push({
      id: call?.id || followup?.id || key,
      name,
      offer: shownOffer(followup?.oferta) || shownOffer(call?.oferta) || shownOffer(call?.producto),
      call,
      followup,
      day: String(call?.fecha || followupCalendarDay(followup || {}) || "").slice(0, 10),
      bucket,
      amount: 0,
    });
  };
  for (const key of outcomes.wonKeys) pushOutcome(key, "cerrados");
  for (const key of outcomes.lostKeys) pushOutcome(key, "perdidos");

  const offerOk = (row: Draft) => matchesBoardOffer(row.offer, offer);
  // Cierres and perdidos are already limited to the period. Seguimiento stays every open follow-up.
  const scoped = drafts.filter((row) => (row.bucket === "seguimiento" ? offerOk(row) : true));
  const searched = query ? scoped.filter((row) => fold(row.name).includes(query)) : scoped;

  const toPerson = (row: Draft): CrmBoardPerson => {
    const pay = pagoLabel(row.call, money);
    let chip: FollowupChip | null = null;
    if (row.bucket === "seguimiento" && row.followup && followupCalendarDay(row.followup)) {
      chip = followupChip(row.followup, now);
    } else if (row.bucket === "cerrados") {
      chip = { tone: "future", label: "Cerró" };
    } else if (row.bucket === "perdidos") {
      chip = { tone: "future", label: "Perdido" };
    }
    const leftOff = row.bucket === "seguimiento" && row.followup ? leftOffOf(row.followup, row.call, now) : "";
    return {
      id: row.id,
      leadId: String(row.followup?.leadId || row.call?.leadId || ""),
      callId: row.call?.id || "",
      alertId: row.bucket === "seguimiento" && row.followup ? row.followup.id : "",
      name: row.name,
      initials: initialsOf(row.name),
      offer: row.offer,
      pago: pay.pago,
      pagoNote: pay.note,
      leftOff,
      chip,
      bucket: row.bucket,
      ask: askFor(row.name),
    };
  };

  const counts = {
    cerrados: outcomes.won,
    seguimiento: scoped.filter((row) => row.bucket === "seguimiento").length,
    perdidos: outcomes.lost,
  };

  // Hoy stays the Inicio list. The name search only narrows the table below.
  const hoyDrafts = drafts.filter(
    (row) => row.bucket === "seguimiento" && offerOk(row) && row.day && calendarDaysBetween(row.day, today) <= 0,
  );
  const hoy = hoyDrafts.map(toPerson);

  const inBucket = searched.filter((row) => row.bucket === bucket);
  if (bucket === "cerrados" || bucket === "perdidos") {
    inBucket.sort((a, b) => (b.day || "").localeCompare(a.day || "") || a.name.localeCompare(b.name, "es"));
  }
  const hoyNames = new Set(hoyDrafts.map((row) => fold(row.name)));
  const tableDrafts =
    bucket === "seguimiento" ? inBucket.filter((row) => !hoyNames.has(fold(row.name))) : inBucket;
  const rows = tableDrafts.map(toPerson);

  const monthCalls = calls.filter((row) => String(row.fecha || "").startsWith(month.key) && matchesBoardOffer(shownOffer(row.oferta) || shownOffer(row.producto), offer));
  let cobrado = 0;
  for (const row of monthCalls) {
    const cash = Number(row.cash);
    if (Number.isFinite(cash) && cash > 0) cobrado += cash;
  }
  const monthClosed = monthOutcomes.won;
  const closedLine =
    monthClosed == null || monthClosed <= 0
      ? ""
      : monthClosed === 1
        ? "1 persona cerró este mes"
        : `${monthClosed} personas cerraron este mes`;
  const cashLine = cobrado > 0 ? `${money(cobrado)} cobrados` : "";
  const subtitle = [closedLine, cashLine].filter(Boolean).join(" · ");

  const openCount = counts.seguimiento;
  const hoyNote =
    hoy.length === 0
      ? `Hoy no toca nadie · ${peoplePhrase(openCount, "en seguimiento")}`
      : `${peoplePhrase(hoy.length, "para hoy")} · ${peoplePhrase(openCount, "en seguimiento")}`;

  const total = counts[bucket];
  const shown = rows.length;
  const order = bucket === "seguimiento" ? "ordenados por fecha de seguimiento" : "ordenados por fecha";
  const footer =
    total == null
      ? ""
      : bucket === "seguimiento" && !query && total > 0
        ? shown === 0
          ? peoplePhrase(total, "en seguimiento")
          : `${peoplePhrase(shown, "más adelante")} · ${peoplePhrase(total, "en seguimiento")}`
        : shown === total
          ? `${peoplePhrase(total, "")} · ${order}`
          : `${shown} de ${total} · ${order}`;
  const empty =
    bucket === "cerrados" && outcomes.won == null
      ? "Sin datos de cierres en este período."
      : bucket === "perdidos" && outcomes.lost == null
        ? "Sin datos de perdidos en este período."
        : shown === 0 && bucket === "seguimiento" && (total || 0) > 0
          ? query
            ? "Nadie más con ese nombre. Si toca hoy, está en la lista de arriba."
            : "Esas personas ya están en «A quién contactar hoy»."
          : bucket === "cerrados"
            ? "No hay cierres en este período."
            : bucket === "perdidos"
              ? "No hay perdidos en este período."
              : "No hay personas en seguimiento en este período.";

  return {
    subtitle,
    hoy,
    hoyNote,
    counts,
    rows,
    shown,
    total,
    footer,
    empty: shown === 0 ? empty : "",
    restTitle: bucket === "seguimiento" && shown > 0 && hoy.length > 0 && !query ? "Más adelante" : "",
  };
}

export const CRM_BOARD_BUCKETS = BUCKETS;
