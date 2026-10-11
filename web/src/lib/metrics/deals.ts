// Ventas, cobrado, comisión ganada y saldo (plan 1.3).
// The Deal table arrives in PR 6; these functions take plain rows so every
// screen already has a single definition to import.
import { type MoneyLike, type MoneySum, sumInCurrency, toCents } from "./money";

export type DealRow = {
  status: "ACTIVO" | "ANULADO";
  closedAt: Date;
  currency: string;
  amountTotal: MoneyLike;
  cashCollected: MoneyLike;
  commissionAmount: MoneyLike;
};

export type Range = { start: Date; end: Date };

const inRange = (at: Date, r: Range) => at >= r.start && at < r.end;
const activeIn = (deals: DealRow[], r: Range) => deals.filter((d) => d.status === "ACTIVO" && inRange(d.closedAt, r));

/** ventas: Σ amountTotal of active deals closed in the period. */
export function salesTotal(deals: DealRow[], period: Range, currency: string): MoneySum {
  return sumInCurrency(activeIn(deals, period).map((d) => ({ amount: d.amountTotal, currency: d.currency })), currency);
}

/** cobrado (phase 2, before installments): Σ cashCollected of active deals closed in the period. */
export function cashCollected(deals: DealRow[], period: Range, currency: string): MoneySum {
  return sumInCurrency(activeIn(deals, period).map((d) => ({ amount: d.cashCollected, currency: d.currency })), currency);
}

/** comisión ganada («Llevas USD …»): Σ commissionAmount, frozen when the deal was created. */
export function commissionEarned(deals: DealRow[], period: Range, currency: string): MoneySum {
  return sumInCurrency(activeIn(deals, period).map((d) => ({ amount: d.commissionAmount, currency: d.currency })), currency);
}

/** saldo: amountTotal − cashCollected; null («sin dato») if either is missing. */
export function balance(deal: Pick<DealRow, "amountTotal" | "cashCollected">): number | null {
  const total = toCents(deal.amountTotal);
  const cash = toCents(deal.cashCollected);
  return total === null || cash === null ? null : total - cash;
}
