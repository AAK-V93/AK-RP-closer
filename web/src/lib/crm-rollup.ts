import { countedSale } from "@/lib/stated-deal";
import { zonedDayKey } from "@/lib/crm-time";
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

export type RollupCall = {
  id?: string;
  cliente?: string | null;
  offerName?: string | null;
  producto?: string | null;
  estadoAgenda?: string | null;
  ventaTotal?: number | null;
  cashCollected?: number | null;
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

export function explainVentas(calls: RollupCall[], prices: number[] = []) {
  const leads: ClosedDeal[] = [];
  for (const call of calls) {
    const at = callInstant(call);
    if (!at) continue;
    const sale = countedSale(call.ventaTotal, { at, prices });
    const booked = bookedSale(call.estadoAgenda, sale);
    if (!booked) continue;
    leads.push({
      id: call.id || "",
      cliente: String(call.cliente || "").trim() || "Sin nombre",
      fecha: at ? zonedDayKey(at) : "",
      venta: booked,
      oferta: String(call.offerName || call.producto || "").trim(),
    });
  }
  return {
    n: leads.length,
    total: leads.reduce((sum, row) => sum + row.venta, 0),
    leads,
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

    const at = callInstant(call);
    const sale = countedSale(call.ventaTotal, { at, prices });
    const collected = countedSale(call.cashCollected, { at, prices });
    const booked = bookedSale(estado, sale);
    if (booked) cierres += 1;
    ventas += booked;
    cash += collected;

    const name = matchOffer(call, catalog);
    const row = name ? rows.get(name) : undefined;
    if (!row) continue;
    if (booked) {
      row.cierres += 1;
      row.ventas += booked;
    }
    row.cash += collected;
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
