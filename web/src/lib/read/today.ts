// Hoy (plan 2.1): stats of the month, counters and 5 people. Goal reading
// arrives with MonthlyGoal in PR 4.
import type { DayKey } from "@/lib/time/bogota";
import { dateOnly } from "@/lib/time/bogota";
import { type Db, amount, iso } from "./dto";

export async function readTodayHeader(db: Db, userId: string, month: DayKey) {
  const [stats, counters] = await Promise.all([
    db.userMonthStats.findFirst({
      where: { userId, month: dateOnly(month), offerId: null },
      select: { callsHeld: true, closedCount: true, lostCount: true, commissionEarned: true },
    }),
    readCounters(db, userId),
  ]);
  return {
    month,
    stats: stats ? { ...stats, commissionEarned: amount(stats.commissionEarned)! } : null,
    counters,
  };
}

export async function readCounters(db: Db, userId: string) {
  const c = await db.userCounters.findUnique({
    where: { userId },
    select: {
      pendingConfirmCount: true,
      followingCount: true,
      lastCloseAt: true,
      lastCloseLeadName: true,
      callsSinceLastClose: true,
      topObjectionLabel: true,
      topObjectionHits: true,
      topObjectionOf: true,
    },
  });
  return c ? { ...c, lastCloseAt: iso(c.lastCloseAt) } : null;
}

export const PERSON_ROW_SELECT = {
  id: true,
  name: true,
  offerId: true,
  oneLine: true,
  phone: true,
  status: true,
  lastContactAt: true,
  lastCallAt: true,
  nextContactAt: true,
  attemptsSinceLastCall: true,
  potentialCommission: true,
  currency: true,
} as const;

type PersonRowRaw = {
  id: string;
  name: string;
  offerId: string | null;
  oneLine: string | null;
  phone: string | null;
  status: "SEGUIMIENTO" | "CERRADO" | "PERDIDO";
  lastContactAt: Date | null;
  lastCallAt: Date | null;
  nextContactAt: Date | null;
  attemptsSinceLastCall: number;
  potentialCommission: { toString(): string } | null;
  currency: string;
};

export function personRow(r: PersonRowRaw) {
  return {
    ...r,
    lastContactAt: iso(r.lastContactAt),
    lastCallAt: iso(r.lastCallAt),
    nextContactAt: iso(r.nextContactAt),
    potentialCommission: amount(r.potentialCommission),
  };
}
export type PersonRow = ReturnType<typeof personRow>;

export const TODAY_TAKE = 5;

/** The 5 rows of «A quién escribirle hoy»; order them with todayList() from lib/metrics. */
export async function readTodayList(db: Db, userId: string) {
  const rows = await db.lead.findMany({
    where: { userId, status: "SEGUIMIENTO" },
    orderBy: [{ nextContactAt: { sort: "asc", nulls: "last" } }, { potentialCommission: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    take: TODAY_TAKE,
    select: PERSON_ROW_SELECT,
  });
  return rows.map(personRow);
}
