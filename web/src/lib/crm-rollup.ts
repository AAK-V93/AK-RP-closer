import { countedSale, explicitAgreement } from "@/lib/stated-deal";
import { zonedDayKey } from "@/lib/crm-time";
import { normalizePersonName } from "@/lib/lead-match";
import {
  foldOffer,
  isInventedOfferLabel,
  isPriceLabel,
  offersWithDisplayNames,
  type NamedOffer,
} from "@/lib/offer-name";

export type RollupOffer = NamedOffer & {
  prices?: number[];
};

export type CashPayment = { amount: number; at: Date };

export type RollupCall = {
  id?: string;
  leadId?: string | null;
  cliente?: string | null;
  offerName?: string | null;
  producto?: string | null;
  estadoAgenda?: string | null;
  tipoSeguimiento?: string | null;
  acuerdo?: string | null;
  notas?: string | null;
  evidenciaCierre?: string | null;
  evidenciaVenta?: string | null;
  ventaTotal?: number | null;
  cashCollected?: number | null;
  /** When set, cobrado follows these dates instead of the sale date. */
  cashPayments?: CashPayment[];
  recordedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export type ClosedDeal = {
  id: string;
  cliente: string;
  fecha: string;
  venta: number;
  oferta: string;
};

export type OfferRow = {
  oferta: string;
  cierres: number;
  ventas: number;
  cash: number;
};

const AGENDA = new Set([
  "AGENDADO",
  "SHOW",
  "CIERRE VENTA",
  "ACUERDO SIN PAGO",
  "NO SHOW",
  "REPROGRAMA",
]);
const SHOW = new Set(["SHOW", "CIERRE VENTA", "ACUERDO SIN PAGO"]);

export function callInstant(call: {
  recordedAt?: Date | string | null;
  createdAt?: Date | string | null;
}) {
  const raw = call.recordedAt || call.createdAt;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function offerPrices(offers: RollupOffer[]) {
  const prices: number[] = [];
  for (const offer of offers) {
    for (const price of offer.prices || []) {
      if (price > 0 && price <= 1_000_000) prices.push(price);
    }
  }
  return prices;
}

function inRange(date: Date | null, from: Date, to: Date) {
  if (!date) return false;
  return date >= from && date < to;
}

function asInstant(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Stored cuota dates. Null when the call only has a running Cobrado total. */
export function readStoredPayments(filing: unknown): CashPayment[] | null {
  const cobros = (filing as { cobros?: unknown } | null)?.cobros;
  if (!Array.isArray(cobros) || !cobros.length) return null;
  const events: CashPayment[] = [];
  for (const row of cobros) {
    if (!row || typeof row !== "object") continue;
    const amount = Number((row as { amount?: unknown }).amount);
    const at = asInstant((row as { at?: Date | string | null }).at);
    if (!Number.isFinite(amount) || amount === 0 || !at) continue;
    events.push({ amount: Math.round(amount), at });
  }
  return events.length ? events : null;
}

/**
 * Cobrado by the day it was registered. A later cuota is not the sale date.
 * Without stored dates, a commission that is smaller than the current total
 * is the original payment; the rest landed when the lead's Cobrado changed.
 */
export function datedCashPayments(args: {
  cashCollected?: number | null;
  recordedAt?: Date | string | null;
  createdAt?: Date | string | null;
  filingJson?: unknown;
  bookedCash?: number | null;
  bookedAt?: Date | string | null;
  changedAt?: Date | string | null;
}): CashPayment[] {
  const total = Math.round(Number(args.cashCollected) || 0);
  const saleAt = asInstant(args.recordedAt) || asInstant(args.createdAt);
  const stored = readStoredPayments(args.filingJson);
  if (stored) {
    const signed = stored.reduce((sum, row) => sum + row.amount, 0);
    if (total > signed && saleAt) return [...stored, { amount: total - signed, at: saleAt }];
    return stored;
  }
  if (total <= 0 || !saleAt) return [];
  const booked = args.bookedCash == null ? null : Math.round(Number(args.bookedCash));
  const changedAt = asInstant(args.changedAt);
  if (
    booked != null &&
    booked > 0 &&
    booked < total &&
    changedAt &&
    changedAt.getTime() > saleAt.getTime() + 60_000
  ) {
    return [
      { amount: booked, at: asInstant(args.bookedAt) || saleAt },
      { amount: total - booked, at: changedAt },
    ];
  }
  return [{ amount: total, at: saleAt }];
}

/** Append the delta of a Cobrado edit. The previous total keeps the sale date. */
export function cobrosAfterCashChange(args: {
  filingJson?: unknown;
  previous: number;
  next: number;
  at?: Date;
  saleAt?: Date | string | null;
}) {
  if (args.next <= 0) return [];
  const at = args.at || new Date();
  const saleAt = asInstant(args.saleAt) || at;
  const stored = readStoredPayments(args.filingJson);
  const events = (stored || []).map((row) => ({ amount: row.amount, at: row.at.toISOString() }));
  if (!events.length && args.previous > 0) {
    events.push({ amount: Math.round(args.previous), at: saleAt.toISOString() });
  }
  const base = events.reduce((sum, row) => sum + row.amount, 0);
  const delta = Math.round(args.next) - base;
  if (delta !== 0) events.push({ amount: delta, at: at.toISOString() });
  return events;
}

function paymentsOf(call: RollupCall): CashPayment[] {
  if (call.cashPayments) return call.cashPayments;
  return datedCashPayments(call);
}

function matchOffer(
  call: RollupCall,
  catalog: { displayName: string; aliases?: string[]; productName: string }[],
) {
  const raws = [call.offerName, call.producto]
    .map((value) => foldOffer(String(value || "")))
    .filter((value) => value.length >= 3 && !isPriceLabel(value) && !isInventedOfferLabel(value));
  for (const offer of catalog) {
    const names = [offer.displayName, offer.productName, ...(offer.aliases || [])]
      .map((value) => foldOffer(value))
      .filter((value) => value && !isPriceLabel(value));
    if (
      raws.some((raw) =>
        names.some(
          (name) => raw === name || (raw.length >= 4 && name.length >= 4 && (raw.includes(name) || name.includes(raw))),
        ),
      )
    ) {
      return offer.displayName;
    }
  }
  if (catalog.length === 1) return catalog[0].displayName;
  return "";
}

/** A sale is a closed deal that has an amount. A show that only talked a price is not. */
export function bookedSale(estado: string | null | undefined, amount: number) {
  return String(estado || "") === "CIERRE VENTA" && amount > 0 ? amount : 0;
}

function filingBlob(call: RollupCall) {
  return [call.acuerdo, call.notas, call.evidenciaCierre, call.evidenciaVenta]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
}

/** The row only repeated a price. A segunda reunión without an agreement is the same. */
export function mentionedPriceOnly(call: RollupCall) {
  const blob = filingBlob(call);
  if (explicitAgreement(blob)) return false;
  if (isPriceLabel(String(call.producto || "")) || isPriceLabel(String(call.offerName || ""))) return true;
  const tipo = String(call.tipoSeguimiento || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (tipo.includes("SEGUNDA")) return true;
  return String(call.estadoAgenda || "") !== "CIERRE VENTA";
}

/** Same person once. "(QA)" and accents do not make a second deal. */
export function dealLeadKey(call: RollupCall) {
  const name = normalizePersonName(String(call.cliente || ""));
  if (name) return name;
  if (call.leadId) return `id:${call.leadId}`;
  return call.id ? `call:${call.id}` : "";
}

function displayLead(call: RollupCall) {
  const name = String(call.cliente || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || "Sin nombre";
}

type PickedDeal = { call: RollupCall; amount: number; at: Date };

/** One closed deal per lead. The newest real cierre wins. A mentioned price does not qualify. */
export function pickDeals(calls: RollupCall[], prices: number[] = []): PickedDeal[] {
  const best = new Map<string, PickedDeal>();
  for (const call of calls) {
    const at = callInstant(call);
    if (!at) continue;
    const amount = countedSale(call.ventaTotal, { at, prices });
    if (!bookedSale(call.estadoAgenda, amount)) continue;
    if (mentionedPriceOnly(call)) continue;
    const key = dealLeadKey(call);
    if (!key) continue;
    const prev = best.get(key);
    if (prev && prev.at.getTime() > at.getTime()) continue;
    best.set(key, { call, amount, at });
  }
  return [...best.values()];
}

function toDeal(call: RollupCall, at: Date, venta: number): ClosedDeal {
  return {
    id: call.id || "",
    cliente: displayLead(call),
    fecha: zonedDayKey(at),
    venta,
    oferta: String(call.offerName || call.producto || "").trim(),
  };
}

/** Cerró, but nothing to add. One row per person, and not someone who already has a counted deal. */
export function cierresSinMonto(calls: RollupCall[], prices: number[] = []): ClosedDeal[] {
  const sold = new Set(pickDeals(calls, prices).map((pick) => dealLeadKey(pick.call)));
  const best = new Map<string, { call: RollupCall; at: Date }>();
  for (const call of calls) {
    if (String(call.estadoAgenda || "") !== "CIERRE VENTA") continue;
    const at = callInstant(call);
    if (!at) continue;
    const amount = countedSale(call.ventaTotal, { at, prices });
    if (amount > 0) continue;
    const key = dealLeadKey(call);
    if (!key || sold.has(key)) continue;
    const prev = best.get(key);
    if (prev && prev.at.getTime() > at.getTime()) continue;
    best.set(key, { call, at });
  }
  return [...best.values()].map((pick) => toDeal(pick.call, pick.at, 0));
}

export function explainVentas(calls: RollupCall[], prices: number[] = []) {
  const leads = pickDeals(calls, prices).map((pick) => toDeal(pick.call, pick.at, pick.amount));
  return {
    n: leads.length,
    total: leads.reduce((sum, row) => sum + row.venta, 0),
    leads,
    sinMonto: cierresSinMonto(calls, prices),
  };
}

/**
 * Ventas are closed deals with an amount. Cash is money already collected.
 * A calendar year is not an amount unless it is the offer price.
 * With one catalog offer, every counted amount lands on that row.
 */
export function rollupCalls(
  offers: RollupOffer[],
  calls: RollupCall[],
  range?: { from: Date; to: Date } | null,
) {
  const hints = calls.flatMap((call) => [call.offerName || "", call.producto || ""]);
  const catalog = offersWithDisplayNames(offers, hints);
  const prices = offerPrices(offers);
  const rows = new Map<string, OfferRow>(
    catalog.map((offer) => [offer.displayName, { oferta: offer.displayName, cierres: 0, ventas: 0, cash: 0 }]),
  );
  const slice = range
    ? calls.filter((call) => inRange(callInstant(call), range.from, range.to))
    : calls;

  let agendas = 0;
  let shows = 0;
  let noShows = 0;
  let reprogramadas = 0;
  let cierres = 0;
  let ventas = 0;
  let cash = 0;

  for (const call of slice) {
    const estado = String(call.estadoAgenda || "");
    if (AGENDA.has(estado)) agendas += 1;
    if (SHOW.has(estado)) shows += 1;
    if (estado === "NO SHOW") noShows += 1;
    if (estado === "REPROGRAMA") reprogramadas += 1;
  }

  for (const call of calls) {
    const name = matchOffer(call, catalog);
    const row = name ? rows.get(name) : undefined;
    for (const payment of paymentsOf(call)) {
      if (range && !inRange(payment.at, range.from, range.to)) continue;
      const collected =
        payment.amount < 0
          ? payment.amount
          : countedSale(payment.amount, { at: payment.at, prices });
      if (!collected) continue;
      cash += collected;
      if (row) row.cash += collected;
    }
  }

  for (const pick of pickDeals(slice, prices)) {
    cierres += 1;
    ventas += pick.amount;
    const name = matchOffer(pick.call, catalog);
    const row = name ? rows.get(name) : undefined;
    if (!row) continue;
    row.cierres += 1;
    row.ventas += pick.amount;
  }

  return {
    agendas,
    shows,
    noShows,
    reprogramadas,
    cierres,
    showRate: agendas ? shows / agendas : 0,
    closeRate: shows ? cierres / shows : 0,
    ticket: cierres ? ventas / cierres : 0,
    ventas,
    cash,
    cashPct: ventas ? cash / ventas : 0,
    porOferta: [...rows.values()],
  };
}
