// Metas (plan 1.3, PR 4): camino elegido, sugerencia semanal y mes contra mes.
// Pure functions over rows already read; no Prisma here.
import { type DayKey, addDaysKey, addMonthsKey, dateOnly } from "@/lib/time/bogota";
import { type OfferCommission, perCloseCommission } from "./commission";
import { followUpProgress } from "./followup";
import { type GoalPath, type PathMissing, type PathOffer, type StakeLead, closestToGoal, goalPath, goalProgress } from "./goal";
import type { MoneyLike } from "./money";
import { toCents } from "./money";
import { type CountersRow, type MonthNumbers, meetingPace, topBlocker, weekProgress, winRate } from "./results";

/**
 * An offer as a step of «Tu camino». Currency rule: a close only counts
 * towards the goal when the offer is in the goal's currency; otherwise it
 * cannot be valued (missing CURRENCY), never converted.
 */
export function pathOffer(
  offer: OfferCommission & { id: string; name: string; currency: string },
  goalCurrency: string,
): PathOffer {
  if (offer.currency !== goalCurrency) return { id: offer.id, name: offer.name, perCloseCents: null, missing: "CURRENCY" };
  const per = perCloseCommission(offer);
  return { id: offer.id, name: offer.name, perCloseCents: per.cents, missing: per.missing };
}

/** What «Tu camino» says for an offer that cannot be valued. */
export function pathMissingLabel(reason: PathMissing, offerName: string, offerCurrency: string, goalCurrency: string) {
  if (reason === "PRICE") return `Falta el precio de contado de ${offerName}`;
  if (reason === "CURRENCY") return `${offerName} está en ${offerCurrency} y tu meta en ${goalCurrency}: no la sumo al camino`;
  return `Falta tu comisión en ${offerName}`;
}

/** What MonthlyGoal.chosenPath stores. */
export type ChosenPath = {
  offerIds: string[];
  closes: Array<{ offerId: string; count: number }>;
  meetings: number | null;
  chosenAt: string;
};

/** A path is identified by its offers in order: [top], [top, second] or [second]. */
export function pathKey(path: Pick<GoalPath, "closes">) {
  return path.closes.map((c) => c.offerId).join("+");
}

export function toChosenPath(path: GoalPath, now: Date): ChosenPath {
  return {
    offerIds: path.closes.map((c) => c.offerId),
    closes: path.closes.map((c) => ({ offerId: c.offerId, count: c.count })),
    meetings: path.meetings,
    chosenAt: now.toISOString(),
  };
}

/** Reads the stored JSON defensively (it is user data from an older version too). */
export function readChosenPath(value: unknown): ChosenPath | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ChosenPath>;
  if (!Array.isArray(v.offerIds) || !v.offerIds.every((id) => typeof id === "string") || v.offerIds.length === 0) return null;
  return {
    offerIds: v.offerIds,
    closes: Array.isArray(v.closes) ? v.closes : [],
    meetings: typeof v.meetings === "number" ? v.meetings : null,
    chosenAt: typeof v.chosenAt === "string" ? v.chosenAt : "",
  };
}

/**
 * Index of the chosen path among today's paths. Counts are recalculated
 * every time (the goal or the earnings changed), the choice stays by its
 * offers. null = nothing chosen, or the chosen mix no longer exists.
 */
export function chosenPathIndex(paths: GoalPath[], chosen: ChosenPath | null): number | null {
  if (!chosen) return null;
  const key = chosen.offerIds.join("+");
  const i = paths.findIndex((p) => pathKey(p) === key);
  return i === -1 ? null : i;
}

/** Weeks (Monday to Sunday) that still touch the month, the current one included. */
export function weeksLeftInMonth(weekStart: DayKey, month: DayKey): number {
  const next = dateOnly(addMonthsKey(month, 1)).getTime();
  let n = 0;
  for (let w = weekStart; dateOnly(w).getTime() < next; w = addDaysKey(w, 7)) n += 1;
  return Math.max(1, n);
}

/**
 * Meetings to suggest for this week: the chosen path's ≈ meetings spread
 * over the weeks left. null when the pace is «por confirmar» (no suggestion,
 * the person writes their own). Seguimientos have no rule in the plan: the
 * person writes them (prefilled with last week's target).
 */
export function weeklyMeetingsSuggestion(path: Pick<GoalPath, "meetings"> | null, weekStart: DayKey, month: DayKey) {
  if (!path || path.meetings === null) return null;
  return Math.ceil(path.meetings / weeksLeftInMonth(weekStart, month));
}

/** «Te faltan 2 reuniones y 3 seguimientos» parts; null target = nothing to say. */
export function weekRemaining(done: number, target: number | null) {
  return target === null ? null : Math.max(0, target - done);
}

export type Trend = "up" | "down" | "same";
export type Compared<T> = {
  value: T;
  previous: T | null;
  trend: Trend | null;
  /** colour: true = better, false = worse, null = equal or no previous month */
  better: boolean | null;
};

function compare(value: number, previous: number | null, moreIsBetter: boolean): Compared<number> {
  if (previous === null) return { value, previous, trend: null, better: null };
  const trend: Trend = value > previous ? "up" : value < previous ? "down" : "same";
  return { value, previous, trend, better: trend === "same" ? null : (trend === "up") === moreIsBetter };
}

/**
 * «Tus números»: this month against the previous one. Fewer lost is better.
 * Win rate compares won/decided as rates; with nobody deciding there is no rate.
 * previous null = «primer mes» (no arrows).
 */
export function monthCompare(current: MonthNumbers | null, previous: MonthNumbers | null) {
  const cur = current ?? { callsHeld: 0, closedCount: 0, lostCount: 0 };
  const prev = previous;
  const rate = winRate(cur.closedCount, cur.lostCount);
  const prevRate = prev ? winRate(prev.closedCount, prev.lostCount) : null;
  let rateTrend: Trend | null = null;
  if (rate && prevRate) {
    const a = rate.won * prevRate.decided;
    const b = prevRate.won * rate.decided;
    rateTrend = a > b ? "up" : a < b ? "down" : "same";
  }
  return {
    firstMonth: prev === null,
    calls: compare(cur.callsHeld, prev?.callsHeld ?? null, true),
    closed: compare(cur.closedCount, prev?.closedCount ?? null, true),
    lost: compare(cur.lostCount, prev?.lostCount ?? null, false),
    winRate: {
      value: rate,
      previous: prevRate,
      trend: rateTrend,
      better: rateTrend === null || rateTrend === "same" ? null : rateTrend === "up",
    } satisfies Compared<ReturnType<typeof winRate>>,
  };
}

/**
 * «Ponte una meta» ideas (Arquitectura, PR 5): only from her own last month,
 * in any currency: the same, +20 % and +50 %, rounded to whole units. No
 * history (or nothing earned) → no ideas at all, just the field.
 */
export function goalIdeas(lastMonthEarnedCents: number | null): Array<{ cents: number; label: "igual" | "+20%" | "+50%" }> {
  if (lastMonthEarnedCents === null || !(lastMonthEarnedCents > 0)) return [];
  const unit = (c: number) => Math.max(100, Math.round(c / 100) * 100);
  return [
    { cents: unit(lastMonthEarnedCents), label: "igual" as const },
    { cents: unit(lastMonthEarnedCents * 1.2), label: "+20%" as const },
    { cents: unit(lastMonthEarnedCents * 1.5), label: "+50%" as const },
  ].filter((idea, i, all) => all.findIndex((o) => o.cents === idea.cents) === i);
}

/** Kali's rule: 6 to 10 attempts per person; the hint aims at 6 in 3 weeks. */
export const FOLLOWUP_ATTEMPTS_TARGET = 6;
export const FOLLOWUP_WEEKS = 3;

/**
 * Weekly follow-ups hint (suggestion only, never saved): M = ceil(Σ max(0, 6 −
 * attemptsSinceLastCall) over the people in SEGUIMIENTO / 3). `groups` holds
 * how many people have each attempt count (those already at 6+ add nothing).
 * null when nobody is in follow-up or nobody needs more attempts.
 */
export function followupsHint(groups: Array<{ attempts: number; people: number }>, following: number) {
  if (!(following > 0)) return null;
  let missing = 0;
  for (const g of groups) missing += Math.max(0, FOLLOWUP_ATTEMPTS_TARGET - g.attempts) * g.people;
  const perWeek = Math.ceil(missing / FOLLOWUP_WEEKS);
  return perWeek > 0 ? { people: following, perWeek } : null;
}

// ---------- Screen view (composition of the functions above) ----------

type StatsRow = MonthNumbers & { offerId: string | null; commissionEarned: MoneyLike };
export type MetasInput = {
  month: DayKey;
  week: DayKey;
  goal: { targetCommission: MoneyLike; currency: string; chosenPath: unknown } | null;
  current: StatsRow[];
  previous: StatsRow[];
  weekGoal: { meetingsTarget: number; followupsTarget: number } | null;
  lastWeekGoal: { meetingsTarget: number; followupsTarget: number } | null;
  weekDone: { meetings: number; attempts: number };
  /** people in SEGUIMIENTO under 6 attempts, by attempt count */
  attemptGroups: Array<{ attempts: number; people: number }>;
  near: Array<StakeLead & { oneLine: string | null; attemptsSinceLastCall: number }>;
  counters: CountersRow | null;
};
export type MetasOffer = OfferCommission & { id: string; name: string; currency: string };

/**
 * Everything Metas shows, from rows already read. Currency rule: the goal is
 * in goal.currency; earnings count only when that is the user's currency.
 */
export function metasView(input: MetasInput, offers: MetasOffer[], userCurrency: string, now: Date) {
  const all = (rows: StatsRow[]) => rows.find((r) => r.offerId === null) ?? null;
  const curAll = all(input.current);
  const prevAll = all(input.previous);
  const nums = (r: StatsRow | null): MonthNumbers | null =>
    r ? { callsHeld: r.callsHeld, closedCount: r.closedCount, lostCount: r.lostCount } : null;

  const pace = meetingPace(nums(curAll) ?? { callsHeld: 0, closedCount: 0, lostCount: 0 }, nums(prevAll));
  const prevEarned = prevAll ? toCents(prevAll.commissionEarned) : null;

  let goal = null as null | {
    targetCents: number;
    currency: string;
    /** earnings are in another currency than the goal: «por confirmar» */
    earnedUnknown: boolean;
    progress: ReturnType<typeof goalProgress>;
    paths: GoalPath[];
    missing: ReturnType<typeof goalPath>["missing"];
    chosenIndex: number | null;
  };
  if (input.goal) {
    const targetCents = toCents(input.goal.targetCommission) ?? 0;
    const earnedUnknown = input.goal.currency !== userCurrency;
    const earned = earnedUnknown ? 0 : (toCents(curAll?.commissionEarned) ?? 0);
    const progress = goalProgress(targetCents, earned, now);
    const { paths, missing } = goalPath(
      progress.remaining,
      offers.map((o) => pathOffer(o, input.goal!.currency)),
      pace,
    );
    goal = {
      targetCents,
      currency: input.goal.currency,
      earnedUnknown,
      progress,
      paths,
      missing,
      chosenIndex: chosenPathIndex(paths, readChosenPath(input.goal.chosenPath)),
    };
  }

  const chosen = goal && goal.chosenIndex !== null ? goal.paths[goal.chosenIndex] : null;
  const week = weekProgress(input.weekDone, input.weekGoal);
  const offerRow = (rows: StatsRow[], id: string) => rows.find((r) => r.offerId === id) ?? null;
  const zero = { callsHeld: 0, closedCount: 0, lostCount: 0 };

  return {
    pace,
    lastMonthEarnedCents: prevEarned !== null && prevEarned > 0 ? prevEarned : null,
    goalIdeas: goalIdeas(prevEarned),
    goal,
    chosen,
    week: {
      ...week,
      meetingsLeft: weekRemaining(week.meetings.done, week.meetings.target),
      attemptsLeft: weekRemaining(week.attempts.done, week.attempts.target),
      suggestion: {
        meetings: weekGoalSuggestionMeetings(chosen, input.week, input.month, input.weekGoal),
        followups: input.weekGoal?.followupsTarget ?? input.lastWeekGoal?.followupsTarget ?? null,
      },
      followupsHint: followupsHint(input.attemptGroups, input.counters?.followingCount ?? 0),
    },
    numbers: {
      hasData: curAll !== null,
      firstMonth: prevAll === null,
      all: monthCompare(nums(curAll), nums(prevAll)),
      offers: offers.map((o) => ({
        /** any call, close or loss in either month (rows without activity are hidden) */
        active: [offerRow(input.current, o.id), offerRow(input.previous, o.id)].some(
          (r) => r !== null && r.callsHeld + r.closedCount + r.lostCount > 0,
        ),
        id: o.id,
        name: o.name,
        currency: o.currency,
        perClose: perCloseCommission(o),
        compare: monthCompare(nums(offerRow(input.current, o.id)) ?? zero, prevAll ? (nums(offerRow(input.previous, o.id)) ?? zero) : null),
      })),
    },
    near: closestToGoal(input.near, userCurrency, 3).map((l) => ({
      id: l.id,
      name: l.name,
      oneLine: l.oneLine,
      potentialCents: toCents(l.potentialCommission),
      followUp: followUpProgress(l.attemptsSinceLastCall),
    })),
    blocker: topBlocker(input.counters),
  };
}

/** Week form default: the saved target, else the chosen path's share. */
function weekGoalSuggestionMeetings(
  chosen: GoalPath | null,
  week: DayKey,
  month: DayKey,
  saved: { meetingsTarget: number } | null,
) {
  if (saved) return saved.meetingsTarget;
  return weeklyMeetingsSuggestion(chosen, week, month);
}
