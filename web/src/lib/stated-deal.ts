import type { ExtractorJson } from "@/lib/extractor";
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

/** Fills sale, balance and payment mode only when the transcript states the numbers. */
export function fillStatedDeal(text: string, parsed: ExtractorJson): ExtractorJson {
  const raw = withoutPhones(String(text || ""));
  if (!raw.trim()) return parsed;
  if (parsed.venta_total != null && !plausibleDeal(parsed.venta_total)) parsed.venta_total = null;
  if (parsed.saldo_pendiente != null && parsed.saldo_pendiente > MAX_DEAL) parsed.saldo_pendiente = null;
  if (parsed.modo_pago && parsed.modo_pago.replace(/\D/g, "").length > 7) parsed.modo_pago = null;
  const amounts = [...raw.matchAll(/\b(\d{1,3}(?:[.\s]\d{3})+|\d{4,7})\b/g)]
    .map((hit) => moneyToken(hit[1]))
    .filter((n): n is number => n != null);
  const inicialHit = raw.match(
    /inicial(?:\s+de)?\s*(?:usd|us\$|\$)?\s*(\d{1,3}(?:[.\s]\d{3})+|\d{3,7})/i,
  );
  const inicial = inicialHit ? moneyToken(inicialHit[1]) : null;
  const total = amounts.length ? Math.max(...amounts) : null;
  const cuotas = /cuotas?|fraccionad/i.test(raw);
  if (parsed.venta_total == null && total != null && (cuotas || inicial != null || /usd|d[oó]lar/i.test(raw))) {
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
