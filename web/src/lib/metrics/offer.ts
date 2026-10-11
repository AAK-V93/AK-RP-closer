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

/** «El que mejor funciona»: most paid, then most replies; only with real results, one script. */
export function bestScriptId(rows: ScriptStatsRow[]): string | null {
  const withResults = rows.filter((r) => r.usesCount > 0 && (r.paidCount > 0 || r.repliesCount > 0));
  if (!withResults.length) return null;
  const sorted = [...withResults].sort(
    (a, b) => b.paidCount - a.paidCount || b.repliesCount - a.repliesCount || b.usesCount - a.usesCount,
  );
  const [first, second] = sorted;
  if (second && second.paidCount === first.paidCount && second.repliesCount === first.repliesCount) return null;
  return first.id;
}

export function scriptUsage(r: ScriptStatsRow) {
  if (r.usesCount < 1) return { used: "Todavía no lo usas", replies: null, paid: null };
  return {
    used: `Lo usaste ${r.usesCount} ${r.usesCount === 1 ? "vez" : "veces"}`,
    replies: `${r.repliesCount} ${r.repliesCount === 1 ? "respondió" : "respondieron"}`,
    paid: r.paidCount > 0 ? `${r.paidCount} ${r.paidCount === 1 ? "pagó" : "pagaron"}` : null,
  };
}
