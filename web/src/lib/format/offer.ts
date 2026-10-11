// Display lines for an offer card. Numbers come from lib/metrics; this file only words them.
import type { PerClose } from "@/lib/metrics";
import { formatCents, formatMoney } from "./money";

type PriceFields = {
  currency: string;
  priceCash: string | null;
  installmentsCount: number | null;
  installmentAmount: string | null;
};

export function priceLine(o: PriceFields): { value: string; label: string } | null {
  const cash = formatMoney(o.priceCash, o.currency);
  const cuota = formatMoney(o.installmentAmount, o.currency);
  const n = o.installmentsCount;
  if (cash) return { value: cash, label: n ? `de contado · o ${n} ${n === 1 ? "cuota" : "cuotas"}` : "de contado" };
  if (n && cuota) return { value: `${n} ${n === 1 ? "cuota" : "cuotas"}`, label: `de ${cuota}` };
  return null;
}

export function installmentsText(o: PriceFields) {
  const cuota = formatMoney(o.installmentAmount, o.currency);
  if (!o.installmentsCount) return null;
  return `${o.installmentsCount} ${o.installmentsCount === 1 ? "cuota" : "cuotas"}${cuota ? ` de ${cuota}` : ""}`;
}

export function commissionLine(perClose: PerClose, currency: string) {
  if (perClose.cents !== null) return { value: formatCents(perClose.cents, currency)!, label: "tu comisión por cierre" };
  return {
    value: "Por confirmar",
    label: perClose.missing === "PRICE" ? "falta el precio de contado" : "tu comisión por cierre",
  };
}

export const COMMISSION_TYPE_LABEL = {
  PER_CLOSE: "Un monto fijo por cada cierre",
  PCT_SALE: "Un porcentaje de la venta",
  PCT_CASH: "Un porcentaje de lo que se cobra",
} as const;

export function commissionValueText(type: keyof typeof COMMISSION_TYPE_LABEL | null, value: string | null, currency: string) {
  if (!type || value === null) return null;
  if (type === "PER_CLOSE") return formatMoney(value, currency);
  return `${value.replace(/\.00$/, "").replace(".", ",")} %`;
}

export const SCRIPT_ORIGIN_LABEL = { EMPRESA: "De tu empresa", APP: "Sugerido por la app", PROPIO: "Tuyo" } as const;

const DATE = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short" });
export function shortDate(iso: string | null) {
  return iso ? DATE.format(new Date(iso)).replace(".", "") : null;
}
