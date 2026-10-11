// Display only: «USD 10.000». No arithmetic on amounts here.
export function formatMoney(amount: string | number | null | undefined, currency: string) {
  if (amount === null || amount === undefined || amount === "") return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const decimals = Number.isInteger(n) ? 0 : 2;
  return `${currency} ${new Intl.NumberFormat("es-CO", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n)}`;
}

export function formatCents(cents: number | null, currency: string) {
  return cents === null ? null : formatMoney((cents / 100).toFixed(2).replace(/\.00$/, ""), currency);
}
