// Metas (plan 2.1): goal of the month, month vs previous month (all + per
// offer), this week's counts and targets, top 3 «en juego», counters.
// Every query is indexed and bounded; counts are groupBy (count() is banned).
import { type DayKey, addDaysKey, addMonthsKey, dateOnly, dateOnlyKey, weekRange } from "@/lib/time/bogota";
import { FOLLOWUP_ATTEMPTS_TARGET } from "@/lib/metrics/metas";
import { type Db, amount } from "./dto";
import { OFFERS_TAKE } from "./offers";
import { readCounters, readDealCurrencies } from "./today";

/** Monday of the week of a local day. */
export function weekStartOf(day: DayKey): DayKey {
  return addDaysKey(day, -((dateOnly(day).getUTCDay() + 6) % 7));
}

export const NEAR_TAKE = 3;

export async function readGoals(db: Db, userId: string, today: DayKey, currency: string) {
  const month = `${today.slice(0, 7)}-01`;
  const prevMonth = addMonthsKey(month, -1);
  const week = weekStartOf(today);
  const prevWeek = addDaysKey(week, -7);
  const { start, end } = weekRange(week);

  const [goal, stats, weekGoals, meetings, attempts, near, counters, attemptGroups, dealCurrencies] = await Promise.all([
    db.monthlyGoal.findUnique({
      where: { userId_month: { userId, month: dateOnly(month) } },
      select: { targetCommission: true, currency: true, chosenPath: true },
    }),
    db.userMonthStats.findMany({
      where: { userId, month: { in: [dateOnly(month), dateOnly(prevMonth)] } },
      select: { month: true, offerId: true, callsHeld: true, closedCount: true, lostCount: true, commissionEarned: true },
      take: 2 * (1 + OFFERS_TAKE),
    }),
    db.weeklyGoal.findMany({
      where: { userId, weekStart: { in: [dateOnly(week), dateOnly(prevWeek)] } },
      select: { weekStart: true, meetingsTarget: true, followupsTarget: true },
      take: 2,
    }),
    db.call.groupBy({
      by: ["state"],
      where: { userId, state: "CONFIRMED", recordedAt: { gte: start, lt: end } },
      _count: { _all: true },
      orderBy: { state: "asc" },
      take: 1,
    }),
    db.leadEvent.groupBy({
      by: ["type"],
      where: { userId, type: "ATTEMPT", undoneAt: null, at: { gte: start, lt: end } },
      _count: { _all: true },
      orderBy: { type: "asc" },
      take: 1,
    }),
    db.lead.findMany({
      where: { userId, status: "SEGUIMIENTO", currency, potentialCommission: { not: null } },
      orderBy: [{ potentialCommission: "desc" }, { name: "asc" }],
      take: NEAR_TAKE,
      select: {
        id: true,
        name: true,
        oneLine: true,
        status: true,
        potentialCommission: true,
        currency: true,
        attemptsSinceLastCall: true,
      },
    }),
    readCounters(db, userId),
    // weekly follow-ups hint: people in SEGUIMIENTO still under 6 attempts, by attempt count (≤ 6 groups)
    db.lead.groupBy({
      by: ["attemptsSinceLastCall"],
      where: { userId, status: "SEGUIMIENTO", attemptsSinceLastCall: { lt: FOLLOWUP_ATTEMPTS_TARGET } },
      _count: { _all: true },
      orderBy: { attemptsSinceLastCall: "asc" },
      take: FOLLOWUP_ATTEMPTS_TARGET,
    }),
    readDealCurrencies(db, userId, month),
  ]);

  const row = (r: (typeof stats)[number]) => ({
    offerId: r.offerId,
    callsHeld: r.callsHeld,
    closedCount: r.closedCount,
    lostCount: r.lostCount,
    commissionEarned: amount(r.commissionEarned)!,
  });
  const ofMonth = (m: DayKey) => stats.filter((r) => dateOnlyKey(r.month) === m).map(row);
  const thisWeek = weekGoals.find((w) => dateOnlyKey(w.weekStart) === week) ?? null;
  const lastWeek = weekGoals.find((w) => dateOnlyKey(w.weekStart) === prevWeek) ?? null;
  const strip = (w: typeof thisWeek) => (w ? { meetingsTarget: w.meetingsTarget, followupsTarget: w.followupsTarget } : null);

  return {
    today,
    month,
    prevMonth,
    week,
    goal: goal
      ? { targetCommission: amount(goal.targetCommission)!, currency: goal.currency, chosenPath: goal.chosenPath ?? null }
      : null,
    current: ofMonth(month),
    previous: ofMonth(prevMonth),
    weekGoal: strip(thisWeek),
    lastWeekGoal: strip(lastWeek),
    weekDone: { meetings: meetings[0]?._count._all ?? 0, attempts: attempts[0]?._count._all ?? 0 },
    attemptGroups: attemptGroups.map((g) => ({ attempts: g.attemptsSinceLastCall, people: g._count._all })),
    near: near.map((l) => ({ ...l, potentialCommission: amount(l.potentialCommission) })),
    counters,
    /** sales of the month in another currency than the user's: not in the sums */
    otherCurrencySales: dealCurrencies.filter((d) => d.currency !== currency),
  };
}
export type GoalsData = Awaited<ReturnType<typeof readGoals>>;

/** Hoy 01b «Empieza en 3 pasos»: is there a goal this month, an offer, a call? */
export async function readStartSteps(db: Db, userId: string, month: DayKey) {
  const [goal, offer, call, fathom] = await Promise.all([
    db.monthlyGoal.findUnique({
      where: { userId_month: { userId, month: dateOnly(month) } },
      select: { targetCommission: true, currency: true },
    }),
    db.offer.findFirst({ where: { userId, archivedAt: null }, select: { id: true } }),
    db.call.findFirst({ where: { userId }, select: { id: true } }),
    db.fathomConnection.findUnique({ where: { userId }, select: { backfillStatus: true } }),
  ]);
  return {
    goal: goal ? { targetCommission: amount(goal.targetCommission)!, currency: goal.currency } : null,
    hasOffer: Boolean(offer),
    hasCall: Boolean(call),
    /** RUNNING → Hoy runs one rebuild burst after the response */
    backfill: fathom?.backfillStatus ?? ("NONE" as const),
  };
}
