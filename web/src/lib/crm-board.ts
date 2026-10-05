import {
  compareFollowupRank,
  foldLeadName,
  followupCalendarDay,
  followupRankInput,
  pickOpenByName,
} from "@/lib/crm-followups";
import { calendarDaysBetween, zonedDayKey, zonedMonthRange, shiftZonedMonth } from "@/lib/crm-time";
import { followupChip, initialsOf, shownOffer, type FollowupChip } from "@/lib/inicio-view";

export type CrmBoardBucket = "cerrados" | "seguimiento" | "perdidos";
export type CrmBoardPeriod = "mes" | "anterior" | "todo";

export type CrmBoardCall = {
  id: string;
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
};

export type CrmBoardFollowup = {
  id: string;
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
  name: string;
  initials: string;
  offer: string;
  pago: string;
  pagoNote: string;
  chip: FollowupChip | null;
  bucket: CrmBoardBucket;
  /** Question the row writes into the chat. */
  ask: string;
};

export type CrmBoard = {
  subtitle: string;
  hoy: CrmBoardPerson[];
  hoyNote: string;
  counts: Record<CrmBoardBucket, number>;
  rows: CrmBoardPerson[];
  shown: number;
  total: number;
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

function isLost(value: string | null | undefined) {
  return /\bperdid/.test(fold(String(value || "")));
}

function isClosedSale(estadoAgenda?: string, leadStatus?: string) {
  const blob = `${estadoAgenda || ""} ${leadStatus || ""}`.toUpperCase().replace(/_/g, " ");
  return /\bCIERRE VENTA\b|\bCERRADO\b|\bCERRO\b/.test(blob);
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
  const previous = shiftZonedMonth(now, -1);
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

  const lostNames = new Set<string>();
  for (const row of calls) {
    if (isLost(row.leadStatus) || isLost(row.seguimientoResultado) || isLost(row.estadoAgenda)) {
      lostNames.add(foldLeadName(row.cliente));
    }
  }
  for (const row of args.followups) {
    if (isLost(row.leadStatus)) lostNames.add(foldLeadName(row.cliente));
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
  const seen = new Set(seguimiento.map((row) => foldLeadName(row.name)));

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
    if (lostNames.has(key)) lostNames.delete(key);
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

  for (const [key, rows] of byName) {
    if (seen.has(key) || lostNames.has(key)) continue;
    const call = latestCall(rows);
    if (!call || !isClosedSale(call.estadoAgenda, call.leadStatus)) continue;
    const name = call.cliente.trim();
    if (!name) continue;
    drafts.push({
      id: call.id,
      name,
      offer: shownOffer(call.oferta) || shownOffer(call.producto),
      call,
      day: String(call.fecha || "").slice(0, 10),
      bucket: "cerrados",
      amount: 0,
    });
  }

  for (const key of lostNames) {
    if (seen.has(key)) continue;
    const call = latestCall(byName.get(key) || []);
    const followup = args.followups.find((row) => foldLeadName(row.cliente) === key);
    const name = (call?.cliente || followup?.cliente || "").trim();
    if (!name) continue;
    drafts.push({
      id: call?.id || followup?.id || key,
      name,
      offer: shownOffer(followup?.oferta) || shownOffer(call?.oferta) || shownOffer(call?.producto),
      call,
      followup,
      day: String(call?.fecha || followupCalendarDay(followup || {}) || "").slice(0, 10),
      bucket: "perdidos",
      amount: 0,
    });
  }

  const offerOk = (row: Draft) => matchesBoardOffer(row.offer, offer);
  const periodOk = (row: Draft) => {
    // Inicio counts every open follow-up. The month filter stays on cierres and perdidos.
    if (row.bucket === "seguimiento") return true;
    if (period === "todo") return true;
    if (!row.day) return false;
    const key = period === "mes" ? month.key : previous.key;
    return row.day.startsWith(key);
  };

  const scoped = drafts.filter((row) => offerOk(row) && periodOk(row));
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
    return {
      id: row.id,
      name: row.name,
      initials: initialsOf(row.name),
      offer: row.offer,
      pago: pay.pago,
      pagoNote: pay.note,
      chip,
      bucket: row.bucket,
      ask: askFor(row.name),
    };
  };

  const counts = { cerrados: 0, seguimiento: 0, perdidos: 0 };
  for (const row of scoped) counts[row.bucket] += 1;

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
  const monthClosed = drafts.filter(
    (row) => row.bucket === "cerrados" && offerOk(row) && String(row.day || "").startsWith(month.key),
  ).length;
  const closedLine =
    monthClosed === 1
      ? "1 persona cerró este mes"
      : monthClosed > 1
        ? `${monthClosed} personas cerraron este mes`
        : "";
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
    bucket === "seguimiento" && !query && total > 0
      ? shown === 0
        ? peoplePhrase(total, "en seguimiento")
        : `${peoplePhrase(shown, "más adelante")} · ${peoplePhrase(total, "en seguimiento")}`
      : shown === total
        ? `${peoplePhrase(total, "")} · ${order}`
        : `${shown} de ${total} · ${order}`;
  const empty =
    shown === 0 && bucket === "seguimiento" && total > 0
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
