// Cierres, ritmo, personas del mes, semana y lo que más te frena (plan 1.3).
import { daysBetween } from "@/lib/time/bogota";

export type MonthNumbers = { callsHeld: number; closedCount: number; lostCount: number };

/** «Ganas X de cada Y que deciden». null when nobody decided (no rate shown). */
export function winRate(closed: number, lost: number): { won: number; decided: number } | null {
  const decided = closed + lost;
  return decided > 0 ? { won: closed, decided } : null;
}

export const PACE_MIN_DECIDED = 3;

/**
 * «Cierras 1 de cada N» over the current and the previous month.
 * null = «por confirmar» (fewer than 3 decided, or no close yet).
 */
export function meetingPace(current: MonthNumbers, previous: MonthNumbers | null): number | null {
  const calls = current.callsHeld + (previous?.callsHeld ?? 0);
  const closed = current.closedCount + (previous?.closedCount ?? 0);
  const lost = current.lostCount + (previous?.lostCount ?? 0);
  if (closed + lost < PACE_MIN_DECIDED || closed === 0) return null;
  return Math.max(1, Math.round(calls / closed));
}

export type CountersRow = {
  followingCount: number;
  pendingConfirmCount: number;
  callsSinceLastClose: number;
  lastCloseAt: Date | string | null;
  lastCloseLeadName: string | null;
  topObjectionLabel: string | null;
  topObjectionHits: number | null;
  topObjectionOf: number | null;
};

/** «N llamadas desde tu último cierre» or «Aún no registras cierres». */
export function sinceLastClose(counters: CountersRow | null, now: Date) {
  const calls = counters?.callsSinceLastClose ?? 0;
  if (!counters?.lastCloseAt) return { calls, lastClose: null };
  const at = new Date(counters.lastCloseAt);
  return {
    calls,
    lastClose: { at, leadName: counters.lastCloseLeadName, daysAgo: Math.max(0, daysBetween(at, now)) },
  };
}

/** Banner «Tienes N llamadas por confirmar»; 0 = no banner. */
export function pendingToConfirm(counters: CountersRow | null): number {
  return counters?.pendingConfirmCount ?? 0;
}

/**
 * Personas del mes = en seguimiento (all, no period) + cerrados in the month
 * + perdidos in the month. The tabs, Hoy and Metas all use this.
 */
export function peopleTabs(
  counters: Pick<CountersRow, "followingCount"> | null,
  month: Pick<MonthNumbers, "closedCount" | "lostCount"> | null,
) {
  const following = counters?.followingCount ?? 0;
  const closed = month?.closedCount ?? 0;
  const lost = month?.lostCount ?? 0;
  return { following, closed, lost, total: following + closed + lost };
}

/** «N personas más» under the 5 rows of Hoy. */
export function morePeople(counters: Pick<CountersRow, "followingCount"> | null, shown: number) {
  return Math.max(0, (counters?.followingCount ?? 0) - shown);
}

/** Esta semana: reuniones and seguimientos against WeeklyGoal (null goal = no target). */
export function weekProgress(
  done: { meetings: number; attempts: number },
  goal: { meetingsTarget: number; followupsTarget: number } | null,
) {
  return {
    meetings: { done: done.meetings, target: goal?.meetingsTarget ?? null },
    attempts: { done: done.attempts, target: goal?.followupsTarget ?? null },
  };
}

export const BLOCKER_MIN_LOST = 3;

/**
 * «Lo que más te frena»: the most repeated objection in the last 5 lost calls,
 * stored on UserCounters. With fewer than 3 such calls there is no personal
 * data: null, and the screen shows the generic practice labelled as such.
 */
export function topBlocker(counters: CountersRow | null) {
  if (!counters?.topObjectionLabel || !counters.topObjectionHits || !counters.topObjectionOf) return null;
  if (counters.topObjectionOf < BLOCKER_MIN_LOST) return null;
  return { label: counters.topObjectionLabel, hits: counters.topObjectionHits, of: counters.topObjectionOf };
}
