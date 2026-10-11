// «A quién escribirle hoy» order (plan 2.1): first what is due today or
// earlier, then the highest potential commission, then fewer attempts.
import { type DayKey, bogotaDay } from "@/lib/time/bogota";
import { type MoneyLike, toCents } from "./money";

export type TodayRow = {
  nextContactAt: Date | string | null;
  potentialCommission: MoneyLike;
  attemptsSinceLastCall: number;
};

export function todayList<T extends TodayRow>(rows: T[], today: DayKey): T[] {
  const due = (r: T) => (r.nextContactAt ? bogotaDay(new Date(r.nextContactAt)) <= today : false);
  return [...rows].sort(
    (a, b) =>
      Number(due(b)) - Number(due(a)) ||
      (toCents(b.potentialCommission) ?? -1) - (toCents(a.potentialCommission) ?? -1) ||
      a.attemptsSinceLastCall - b.attemptsSinceLastCall,
  );
}
