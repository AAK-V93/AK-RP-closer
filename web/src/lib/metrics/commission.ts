// The commission rule lives only here (plan 1.3 and risk 7).
// Pending decision from Kali: does commission count at close or at collection?
// Until then: PER_CLOSE counts at close, PCT_SALE on the sale amount,
// PCT_CASH on what was collected. Changing the rule is a change to this file.
import { type MoneyLike, toCents } from "./money";

export type CommissionType = "PER_CLOSE" | "PCT_SALE" | "PCT_CASH";

export type OfferCommission = {
  commissionType: CommissionType | null;
  commissionValue: MoneyLike;
  priceCash?: MoneyLike;
};

/** Amount to freeze on Deal.commissionAmount; null = «por confirmar». */
export function commissionForDeal(
  offer: OfferCommission,
  deal: { amountTotal: MoneyLike; cashCollected: MoneyLike },
): number | null {
  const value = toCents(offer.commissionValue);
  if (!offer.commissionType || value === null) return null;
  if (offer.commissionType === "PER_CLOSE") return value;
  const base = toCents(offer.commissionType === "PCT_SALE" ? deal.amountTotal : deal.cashCollected);
  if (base === null) return null;
  return Math.round((base * value) / 100 / 100);
}

export type PerClose =
  | { cents: number; missing: null }
  | { cents: null; missing: "COMMISSION" | "PRICE" };

/**
 * Commission one more close of this offer would bring, for «en juego» and
 * «Tu camino». PCT_* use only the cash price: without priceCash it is
 * «por confirmar» (missing PRICE), never computed from installments.
 */
export function perCloseCommission(offer: OfferCommission): PerClose {
  const value = toCents(offer.commissionValue);
  if (!offer.commissionType || value === null) return { cents: null, missing: "COMMISSION" };
  if (offer.commissionType === "PER_CLOSE") return { cents: value, missing: null };
  const price = toCents(offer.priceCash);
  if (price === null) return { cents: null, missing: "PRICE" };
  return { cents: Math.round((price * value) / 100 / 100), missing: null };
}

export function commissionPerClose(offer: OfferCommission): number | null {
  return perCloseCommission(offer).cents;
}

/** What the screen says when a close of this offer cannot be valued. */
export function missingPerCloseLabel(reason: "COMMISSION" | "PRICE", offerName: string) {
  return reason === "PRICE" ? `Falta el precio de contado de ${offerName}` : `Falta tu comisión en ${offerName}`;
}
