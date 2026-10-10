/**
 * One truth for «cuánto pagó y cuánto falta». The ficha, the CRM row and
 * Comisiones all read this, so they always add up: total = pagado + falta.
 *
 * Source: the sale total (venta_total) and what was collected (cash_collected)
 * of the person's sale call. A stored «saldo pendiente» is only used when there
 * is no sale total, because it is not updated when the cash changes later
 * (Valeria: 1.597 total, 1.066 cobrado, saldo guardado 1.064 → falta 531).
 */
export type DealMoney = { total: number; pagado: number; falta: number };

function amount(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

export function dealMoney(input: {
  venta?: number | string | null;
  cash?: number | string | null;
  saldo?: number | string | null;
}): DealMoney {
  const total = amount(input.venta);
  const pagado = amount(input.cash);
  if (total > 0) {
    const paid = Math.min(pagado, total);
    return { total, pagado: paid, falta: Math.max(0, Math.round((total - paid) * 100) / 100) };
  }
  const falta = amount(input.saldo);
  return { total: pagado + falta, pagado, falta };
}

/** The call that carries the sale: newest with a sale total, else newest with cash. */
export function saleCall<T extends { venta?: unknown; cash?: unknown }>(rowsNewestFirst: readonly T[]): T | undefined {
  return rowsNewestFirst.find((row) => amount(row.venta) > 0) || rowsNewestFirst.find((row) => amount(row.cash) > 0);
}

/**
 * Comisiones with no commission rows still tells the truth about money collected,
 * from the same dealMoney numbers as the ficha and the CRM row.
 */
export function cobradoSinComision(
  rows: readonly { cliente?: string | null; venta?: number | string | null; cash?: number | string | null; saldo?: number | string | null }[],
  money: (value: number) => string,
) {
  const byPerson = new Map<string, DealMoney>();
  for (const row of rows) {
    const deal = dealMoney(row);
    if (deal.pagado <= 0) continue;
    const key = String(row.cliente || "").trim().toLowerCase();
    const prev = byPerson.get(key);
    if (!prev || deal.pagado > prev.pagado) byPerson.set(key, deal);
  }
  const pagado = [...byPerson.values()].reduce((sum, deal) => sum + deal.pagado, 0);
  const falta = [...byPerson.values()].reduce((sum, deal) => sum + deal.falta, 0);
  if (pagado <= 0) return "Todavía no hay dinero cobrado en llamadas.";
  const people = byPerson.size === 1 ? "1 persona" : `${byPerson.size} personas`;
  const faltaText = falta > 0 ? ` y falta cobrar ${money(falta)}` : "";
  return `Cobraste ${money(pagado)} de ${people}${faltaText}. No sale comisión porque en Ofertas falta decir cómo te pagan.`;
}
