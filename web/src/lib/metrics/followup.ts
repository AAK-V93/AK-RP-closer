// Seguimientos (plan 1.3).
import { type DayKey, dateOnlyKey } from "@/lib/time/bogota";

export const FOLLOW_UP_MAX = 10;
export const FOLLOW_UP_TARGET_MIN = 6;

/** «Seguimiento N de 10». N = attempts since the last call (Lead.attemptsSinceLastCall). */
export function followUpProgress(attemptsSinceLastCall: number) {
  const count = Math.max(0, Math.trunc(attemptsSinceLastCall || 0));
  return {
    count,
    dots: Math.min(count, FOLLOW_UP_MAX),
    max: FOLLOW_UP_MAX,
    inTarget: count >= FOLLOW_UP_TARGET_MIN,
  };
}

export type FollowUpStage = "SIN_INTENTOS" | "1-2" | "3-5" | "6-10";

/** Etapa 1–2 / 3–5 / 6–10; 0 = «Aún sin intentos». */
export function followUpStage(attemptsSinceLastCall: number): FollowUpStage {
  const n = Math.max(0, Math.trunc(attemptsSinceLastCall || 0));
  if (n === 0) return "SIN_INTENTOS";
  if (n <= 2) return "1-2";
  if (n <= 5) return "3-5";
  return "6-10";
}

/** Range on Lead.attemptsSinceLastCall for the stage filter (6–10 includes more than 10). */
export function followUpStageRange(stage: FollowUpStage): { gte: number; lte?: number } {
  switch (stage) {
    case "SIN_INTENTOS":
      return { gte: 0, lte: 0 };
    case "1-2":
      return { gte: 1, lte: 2 };
    case "3-5":
      return { gte: 3, lte: 5 };
    default:
      return { gte: 6 };
  }
}

/** seguimientos abiertos = leads en SEGUIMIENTO = UserCounters.followingCount. */
export function openFollowUps(counters: { followingCount: number } | null): number {
  return counters?.followingCount ?? 0;
}

export type TaskRow = { status: "OPEN" | "DONE" | "CANCELED"; dueDate: Date };

/** OPEN tasks due today (local Bogotá day). */
export function dueToday<T extends TaskRow>(tasks: T[], today: DayKey): T[] {
  return tasks.filter((t) => t.status === "OPEN" && dateOnlyKey(t.dueDate) === today);
}

/** OPEN tasks from earlier days. Shown as «de días anteriores», never «vencidos». */
export function overdue<T extends TaskRow>(tasks: T[], today: DayKey): T[] {
  return tasks.filter((t) => t.status === "OPEN" && dateOnlyKey(t.dueDate) < today);
}
