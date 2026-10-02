import type { ExtractorJson } from "@/lib/extractor";
import { zonedDayKey } from "@/lib/crm-time";
// type-only: stated-deal must not load extractor at runtime.

const MAX_DEAL = 1_000_000;

export function plausibleDeal(amount: number | null | undefined) {
  return amount != null && amount >= 100 && amount <= MAX_DEAL;
}

function moneyToken(raw: string) {
  const text = raw.trim();
  if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) return bounded(Number(text.replace(/\./g, "")));
  if (/^\d{1,3}(?:,\d{3})+$/.test(text)) return bounded(Number(text.replace(/,/g, "")));
  const digits = text.replace(/[^\d]/g, "");
  if (digits.length > 7) return null;
  return bounded(Number(digits));
}

function bounded(n: number) {
  return Number.isFinite(n) && n >= 100 && n <= MAX_DEAL ? n : null;
}

function withoutPhones(raw: string) {
  return raw
    .replace(/\+\s*\d{1,4}(?:[\s.-]*\d{2,4}){2,6}/g, " ")
    .replace(/\b\d{2}(?:[\s.-]\d{3}){2,4}\b/g, " ");
}

function yearsWrittenAsDates(raw: string) {
  const years = new Set<number>();
  const patterns = [
    /\b\d{1,2}[./-]\d{1,2}[./-](20\d{2})\b/g,
    /\b(20\d{2})-\d{2}-\d{2}\b/g,
    /\bde\s+(20\d{2})\b/g,
  ];
  for (const pattern of patterns) {
    for (const hit of raw.matchAll(pattern)) years.add(Number(hit[1]));
  }
  return years;
}

function withoutDates(raw: string) {
  return raw
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]20\d{2}\b/g, " ")
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ")
    .replace(/\bde\s+20\d{2}\b/g, " ");
}

/** 2026 next to a call in 2026 is the year in the date, not the price. A catalog price of that amount still counts. */
export function isStrayYearAmount(amount: number, at?: Date | string | null) {
  if (!Number.isInteger(amount) || amount < 1990 || amount > 2100) return false;
  const when = at instanceof Date ? at : at ? new Date(at) : new Date();
  if (Number.isNaN(when.getTime())) return false;
  const year = Number(zonedDayKey(when).slice(0, 4));
  if (!Number.isFinite(year) || year < 1990) return false;
  return Math.abs(amount - year) <= 1;
}

export function countedSale(
  amount: number | null | undefined,
  opts?: { at?: Date | string | null; prices?: number[] },
) {
  if (amount == null || !Number.isFinite(amount) || amount <= 0 || amount > MAX_DEAL) return 0;
  const rounded = Math.round(amount);
  if ((opts?.prices || []).some((price) => Math.round(price) === rounded)) return rounded;
  if (isStrayYearAmount(rounded, opts?.at)) return 0;
  return rounded;
}

export function shownMoney(
  amount: number | null | undefined,
  opts?: { at?: Date | string | null; prices?: number[] },
) {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  const n = Number(amount);
  if (n === 0) return 0;
  const counted = countedSale(n, opts);
  return counted > 0 ? counted : null;
}

/** A deal the closer and the lead actually agreed, not a price that was only mentioned. */
export function explicitAgreement(text: string) {
  if (
    /qued[oó]\s+en|quedamos|acord(?:amos|ó|o)\b|cerr(?:é|e|amos|ó)\b|acept[oó]\b|compr[oó]\b|se inscribi[oó]/i.test(
      text,
    )
  ) {
    return true;
  }
  return /inicial\b/i.test(text) && /cuotas?|fraccionad/i.test(text);
}

/** Fills sale, balance and payment mode only when the transcript states the numbers. */
export function fillStatedDeal(text: string, parsed: ExtractorJson): ExtractorJson {
  const original = String(text || "");
  const raw = withoutPhones(withoutDates(original));
  if (!raw.trim() && !original.trim()) return parsed;
  if (parsed.venta_total != null && !plausibleDeal(parsed.venta_total)) parsed.venta_total = null;
  if (parsed.saldo_pendiente != null && parsed.saldo_pendiente > MAX_DEAL) parsed.saldo_pendiente = null;
  if (parsed.modo_pago && parsed.modo_pago.replace(/\D/g, "").length > 7) parsed.modo_pago = null;
  const dateYears = yearsWrittenAsDates(original);
  const clearYear = (amount: number | null) =>
    amount != null &&
    dateYears.has(Math.round(amount)) &&
    isStrayYearAmount(Math.round(amount));
  if (clearYear(parsed.venta_total)) parsed.venta_total = null;
  if (clearYear(parsed.cash_collected)) parsed.cash_collected = null;
  if (clearYear(parsed.saldo_pendiente)) parsed.saldo_pendiente = null;
  const amounts = [...raw.matchAll(/\b(\d{1,3}(?:[.\s,]\d{3})+|\d{4,7})\b/g)]
    .map((hit) => moneyToken(hit[1]))
    .filter((n): n is number => n != null);
  const inicialHit = raw.match(
    /inicial(?:\s+de)?\s*(?:usd|us\$|\$)?\s*(\d{1,3}(?:[.\s,]\d{3})+|\d{3,7})/i,
  );
  const inicial = inicialHit ? moneyToken(inicialHit[1]) : null;
  const total = amounts.length ? Math.max(...amounts) : null;
  const cuotas = /cuotas?|fraccionad/i.test(raw);
  if (parsed.venta_total == null && total != null && explicitAgreement(raw)) {
    parsed.venta_total = total;
    parsed.confianza.venta_total = Math.max(parsed.confianza.venta_total, 85);
  }
  const venta = parsed.venta_total;
  if (parsed.modo_pago == null && cuotas && venta != null) {
    if (inicial != null && inicial < venta) {
      parsed.modo_pago = `Inicial ${inicial} y ${venta - inicial} en cuotas`;
    } else if (/fraccionad/i.test(raw)) {
      parsed.modo_pago = "Fraccionado";
    }
    if (parsed.modo_pago) {
      parsed.confianza.modo_pago = Math.max(parsed.confianza.modo_pago, 85);
    }
  }
  if (parsed.saldo_pendiente == null && venta != null && cuotas) {
    parsed.saldo_pendiente =
      inicial != null && inicial <= venta ? venta - inicial : venta;
  }
  const paid =
    /ya\s+pag|pagu[eé]|pag[oó]\s+la\s+inicial|abon[oó]|comprobante|pago\s+aprobado/i.test(raw);
  if (parsed.cash_collected == null && paid && inicial != null) {
    parsed.cash_collected = inicial;
    parsed.confianza.cash_collected = Math.max(parsed.confianza.cash_collected, 85);
  }
  return parsed;
}
