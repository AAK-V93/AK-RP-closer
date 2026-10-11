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

/**
 * Commission one more close of this offer would bring, for «en juego» and
 * «Tu camino». PCT_* use the cash price; null when something is missing
 * («Falta tu comisión en <oferta>»).
 */
export function commissionPerClose(offer: OfferCommission): number | null {
  const value = toCents(offer.commissionValue);
  if (!offer.commissionType || value === null) return null;
  if (offer.commissionType === "PER_CLOSE") return value;
  const price = toCents(offer.priceCash);
  return price === null ? null : Math.round((price * value) / 100 / 100);
}
