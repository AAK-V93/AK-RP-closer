// Meta, en juego y camino a la meta (plan 1.3).
import { daysLeftInMonth } from "@/lib/time/bogota";
import { type MoneyLike, type MoneySum, sumInCurrency, toCents } from "./money";

/** «USD llevas de USD meta · te faltan · quedan N días». Cents in the user's currency. */
export function goalProgress(targetCents: number, earnedCents: number, now: Date) {
  const remaining = Math.max(0, targetCents - earnedCents);
  return {
    target: targetCents,
    earned: earnedCents,
    remaining,
    done: earnedCents >= targetCents,
    ratio: targetCents > 0 ? Math.min(1, earnedCents / targetCents) : 0,
    daysLeft: daysLeftInMonth(now),
  };
}

export type StakeLead = {
  id: string;
  name: string;
  status: "SEGUIMIENTO" | "CERRADO" | "PERDIDO";
  potentialCommission: MoneyLike;
  currency: string;
};

/** en juego: Σ potentialCommission of leads in SEGUIMIENTO, user's currency only. */
export function atStake(leads: StakeLead[], currency: string): MoneySum {
  return sumInCurrency(
    leads.filter((l) => l.status === "SEGUIMIENTO").map((l) => ({ amount: l.potentialCommission, currency: l.currency })),
    currency,
  );
}

/** «Lo que más te acerca»: top N by potentialCommission (known, user's currency). */
export function closestToGoal<T extends StakeLead>(leads: T[], currency: string, n = 3): T[] {
  return leads
    .filter((l) => l.status === "SEGUIMIENTO" && l.currency === currency && toCents(l.potentialCommission) !== null)
    .sort((a, b) => toCents(b.potentialCommission)! - toCents(a.potentialCommission)! || a.name.localeCompare(b.name))
    .slice(0, n);
}

export type PathOffer = {
  id: string;
  name: string;
  perCloseCents: number | null;
  /** why perCloseCents is null (from perCloseCommission); default COMMISSION */
  missing?: "COMMISSION" | "PRICE" | null;
};
export type GoalPath = {
  closes: Array<{ offerId: string; offerName: string; count: number }>;
  commissionCents: number;
  /** ≈ reuniones; null = «por confirmar» */
  meetings: number | null;
};

/**
 * Tu camino: falta = meta − comisión ganada. At most 3 paths: the highest
 * commission offer, a mix, and the other offer. Offers that cannot be valued
 * go to `missing` with the reason: «Falta tu comisión en <oferta>» or
 * «Falta el precio de contado de <oferta>» (see missingPerCloseLabel).
 */
export function goalPath(remainingCents: number, offers: PathOffer[], pace: number | null) {
  const known = offers
    .filter((o) => o.perCloseCents !== null && o.perCloseCents > 0)
    .sort((a, b) => b.perCloseCents! - a.perCloseCents! || a.name.localeCompare(b.name));
  const missing = offers
    .filter((o) => o.perCloseCents === null)
    .map((o) => ({ offerId: o.id, offerName: o.name, reason: o.missing ?? ("COMMISSION" as const) }));
  const paths: GoalPath[] = [];
  if (remainingCents <= 0 || known.length === 0) return { paths, missing };

  const make = (closes: GoalPath["closes"]): GoalPath => {
    const total = closes.reduce((n, c) => n + c.count, 0);
    const commissionCents = closes.reduce(
      (sum, c) => sum + c.count * known.find((o) => o.id === c.offerId)!.perCloseCents!,
      0,
    );
    return { closes, commissionCents, meetings: pace === null ? null : total * pace };
  };
  const only = (o: PathOffer) => make([{ offerId: o.id, offerName: o.name, count: Math.ceil(remainingCents / o.perCloseCents!) }]);

  const [top, second] = known;
  paths.push(only(top));
  if (second) {
    const firstClose = Math.min(remainingCents, top.perCloseCents!);
    const rest = remainingCents - firstClose;
    if (rest > 0) {
      paths.push(
        make([
          { offerId: top.id, offerName: top.name, count: 1 },
          { offerId: second.id, offerName: second.name, count: Math.ceil(rest / second.perCloseCents!) },
        ]),
      );
    }
    paths.push(only(second));
  }
  return { paths: paths.slice(0, 3), missing };
}
