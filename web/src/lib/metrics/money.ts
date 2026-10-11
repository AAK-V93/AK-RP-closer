// Money in integer cents, so sums never drift. Amounts come from Decimal(12,2)
// columns (Prisma Decimal, string after cache serialization, or number in tests).

export type MoneyLike = string | number | { toString(): string } | null | undefined;

export function toCents(value: MoneyLike): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(typeof value === "number" ? value : String(value));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function centsToAmount(cents: number): number {
  return cents / 100;
}

/**
 * A sum in the user's currency. Rows in another currency are "por confirmar":
 * counted in `otherCurrency`, never added or converted. Rows without an
 * amount are counted in `missing` ("N ventas sin monto").
 */
export type MoneySum = {
  cents: number;
  currency: string;
  counted: number;
  missing: number;
  otherCurrency: number;
};

export function sumInCurrency(
  rows: Array<{ amount: MoneyLike; currency: string | null | undefined }>,
  currency: string,
): MoneySum {
  const out: MoneySum = { cents: 0, currency, counted: 0, missing: 0, otherCurrency: 0 };
  for (const row of rows) {
    if ((row.currency ?? currency) !== currency) {
      out.otherCurrency += 1;
      continue;
    }
    const cents = toCents(row.amount);
    if (cents === null) {
      out.missing += 1;
      continue;
    }
    out.cents += cents;
    out.counted += 1;
  }
  return out;
}
