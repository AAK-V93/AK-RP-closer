// Mis ofertas (plan 3.2 PR 3): when an offer is «Completa», what it still
// needs (one friendly action), and the script numbers shown on each row.
import { type CommissionType, perCloseCommission } from "./commission";
import { type MoneyLike, toCents } from "./money";

export type OfferForCompleteness = {
  priceCash: MoneyLike;
  installmentsCount: number | null;
  installmentAmount: MoneyLike;
  commissionType: CommissionType | null;
  commissionValue: MoneyLike;
  scripts: number;
  /** confirmed, not dismissed */
  cases: number;
  /** read from a source, waiting for the person to confirm */
  casesToReview: number;
};

export type OfferTab = "precios" | "comision" | "guiones" | "casos";

export type OfferStep = {
  key: "PRICE" | "COMMISSION" | "CASH_PRICE" | "SCRIPTS" | "REVIEW_CASES" | "CASES";
  text: string;
  action: string;
  tab: OfferTab;
};

export function hasPrice(o: Pick<OfferForCompleteness, "priceCash" | "installmentsCount" | "installmentAmount">) {
  return toCents(o.priceCash) !== null || (Boolean(o.installmentsCount) && toCents(o.installmentAmount) !== null);
}

/** Complete = price, commission per close known, ≥1 script, ≥1 confirmed case. */
export function offerCompleteness(o: OfferForCompleteness) {
  const steps: OfferStep[] = [];
  const perClose = perCloseCommission(o);
  if (!hasPrice(o)) steps.push({ key: "PRICE", text: "Todavía no tiene precio", action: "Agregar precio", tab: "precios" });
  if (perClose.missing === "COMMISSION") {
    steps.push({ key: "COMMISSION", text: "Todavía no sabes cuánto ganas por cierre", action: "Agregar tu comisión", tab: "comision" });
  } else if (perClose.missing === "PRICE" && hasPrice(o)) {
    steps.push({ key: "CASH_PRICE", text: "Falta el precio de contado para saber tu comisión", action: "Agregar precio de contado", tab: "precios" });
  }
  if (o.scripts < 1) steps.push({ key: "SCRIPTS", text: "Todavía no tiene guiones", action: "Agregar guion", tab: "guiones" });
  if (o.cases < 1) {
    steps.push(
      o.casesToReview > 0
        ? {
            key: "REVIEW_CASES",
            text: `Tienes ${o.casesToReview} ${o.casesToReview === 1 ? "caso" : "casos"} por revisar antes de sugerirlos`,
            action: "Revisar casos",
            tab: "casos",
          }
        : { key: "CASES", text: "Todavía no tiene casos de éxito para sugerir", action: "Agregar enlaces", tab: "casos" },
    );
  }
  return { complete: steps.length === 0, steps, next: steps[0] ?? null, perClose };
}

export type ScriptStatsRow = { id: string; usesCount: number; repliesCount: number; paidCount: number };

/** «El que mejor funciona» only counts scripts used at least this many times. */
export const BEST_SCRIPT_MIN_USES = 5;
/** …and only with this lead over the runner-up, in rate points (0.10 = 10 percentage points). */
export const BEST_SCRIPT_MARGIN = 0.1;

/**
 * «El que mejor funciona» (Arquitectura, PR 3 review, item 6). Compare rates,
 * not totals: payment rate = paid / uses; when payment rates are equal, reply
 * rate = replies / uses. Only scripts with ≥ 5 uses take part, at least two
 * of them, and the winner must lead the runner-up by ≥ 10 percentage points
 * on the rate that decides (payments, or replies when payments tie).
 * Otherwise nobody gets the label.
 */
export function bestScriptId(rows: ScriptStatsRow[]): string | null {
  const ranked = rows
    .filter((r) => r.usesCount >= BEST_SCRIPT_MIN_USES)
    .map((r) => ({ id: r.id, paid: r.paidCount / r.usesCount, replies: r.repliesCount / r.usesCount }))
    .sort((a, b) => b.paid - a.paid || b.replies - a.replies || (a.id < b.id ? -1 : 1));
  const [first, second] = ranked;
  if (!first || !second) return null;
  if (first.paid === 0 && first.replies === 0) return null;
  // round to avoid 0.30000000000000004-style misses at exactly 10 points
  const lead = (x: number, y: number) => Math.round((x - y) * 1e6) / 1e6 >= BEST_SCRIPT_MARGIN;
  if (first.paid !== second.paid) return lead(first.paid, second.paid) ? first.id : null;
  return lead(first.replies, second.replies) ? first.id : null;
}

export function scriptUsage(r: ScriptStatsRow) {
  if (r.usesCount < 1) return { used: "Todavía no lo usas", replies: null, paid: null };
  return {
    used: `Lo usaste ${r.usesCount} ${r.usesCount === 1 ? "vez" : "veces"}`,
    replies: `${r.repliesCount} ${r.repliesCount === 1 ? "respondió" : "respondieron"}`,
    paid: r.paidCount > 0 ? `${r.paidCount} ${r.paidCount === 1 ? "pagó" : "pagaron"}` : null,
  };
}
