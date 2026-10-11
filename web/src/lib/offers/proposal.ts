// What «Leer mi oferta» proposes (from /api/offer-from-doc) → form fields.
// Proposed fields are marked «sugerido» until the person touches them or
// saves; nothing is saved on its own (Arquitectura, PR 3 review, item 1).
// Only empty fields are filled, and only with what the reader returned
// (its commission is already checked against a % cited in the source).

export type OfferFields = {
  name: string;
  description: string;
  currency: string;
  priceCash: string;
  installmentsCount: string;
  installmentAmount: string;
  commissionType: string;
  commissionValue: string;
};

export type OfferProposal = {
  productName?: string;
  productDescription?: string;
  commercial?: {
    listPrice?: number | null;
    currency?: string;
    altPrices?: Array<{ label?: string; amount?: number | null }>;
    commission?: { pctBase?: number | null; base?: string } | null;
  } | null;
};

const num = (n: number) => String(Math.round(n * 100) / 100);

/** Fields the reader can propose, from its answer only. */
export function proposedFields(p: OfferProposal, pastedText = ""): Partial<OfferFields> {
  const out: Partial<OfferFields> = {};
  const c = p.commercial ?? null;
  if (p.productName?.trim()) out.name = p.productName.trim();
  const description = p.productDescription?.trim() || pastedText.trim();
  if (description) out.description = description;
  if (c?.currency && /^[A-Z]{3}$/.test(c.currency)) out.currency = c.currency;
  if (typeof c?.listPrice === "number" && c.listPrice > 0) out.priceCash = num(c.listPrice);
  for (const alt of c?.altPrices ?? []) {
    const m = (alt.label ?? "").match(/(\d{1,2})\s*(?:cuotas?|pagos?)\b/i);
    if (!m) continue;
    out.installmentsCount = String(Number(m[1]));
    if (typeof alt.amount === "number" && alt.amount > 0 && /(?:cuotas?|pagos?)\s+de\b/i.test(alt.label ?? "")) {
      out.installmentAmount = num(alt.amount);
    }
    break;
  }
  const pct = c?.commission?.pctBase;
  if (typeof pct === "number" && pct > 0 && pct <= 1) {
    out.commissionType = c?.commission?.base === "venta_total" ? "PCT_SALE" : "PCT_CASH";
    out.commissionValue = num(pct * 100);
  }
  return out;
}

/** Fill only empty fields; return which ones are «sugerido». */
export function applyProposal(values: OfferFields, proposal: OfferProposal, pastedText = "") {
  const proposed = proposedFields(proposal, pastedText);
  const next = { ...values };
  const suggested: (keyof OfferFields)[] = [];
  for (const [k, v] of Object.entries(proposed) as [keyof OfferFields, string][]) {
    // currency always has a value (USD default): take the proposal only while nothing else was proposed
    const empty = k === "currency" ? true : !values[k];
    if (!empty || v === values[k]) continue;
    next[k] = v;
    suggested.push(k);
  }
  return { values: next, suggested };
}
