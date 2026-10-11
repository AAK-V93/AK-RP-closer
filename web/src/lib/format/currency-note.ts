// Sales in another currency are never added to the totals (no exchange rate is
// invented); Hoy and Metas say how many were left out (Arquitectura, PR 6 review).
export type CurrencyCount = { currency: string; count: number };

/** «+ 2 ventas en EUR no incluidas», one line per other currency. */
export function otherCurrencyNotes(rows: CurrencyCount[], userCurrency: string): string[] {
  return rows
    .filter((r) => r.currency !== userCurrency && r.count > 0)
    .map((r) => (r.count === 1 ? `+ 1 venta en ${r.currency} no incluida` : `+ ${r.count} ventas en ${r.currency} no incluidas`));
}
