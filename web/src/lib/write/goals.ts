// Metas writes (PR 4). Single statements only (Neon HTTP). One MonthlyGoal
// row per month: changing the goal overwrites this month's row, past months
// stay as history and are never deleted.
import type { PrismaClient } from "@prisma/client";
import type { ChosenPath } from "@/lib/metrics";
import { weekStartOf } from "@/lib/read/goals";
import { WRITE_EFFECTS } from "@/lib/read/tags";
import { bogotaDay, bogotaMonth } from "@/lib/time/bogota";
import { invalidate } from "./invalidate";
import { type WriteOpts, type WriteResult, parseAmount } from "./offers";

type Db = PrismaClient;

export const GOAL_MAX = 99_999_999;
export const WEEK_TARGET_MAX = 200;

/** «Ponte una meta» / «Editar». The currency is the user's (aggregates only sum in it). */
export async function setGoal(db: Db, userId: string, input: { amount: string }, opts: WriteOpts = {}): Promise<WriteResult> {
  let target: string | null;
  try {
    target = parseAmount(input.amount);
  } catch {
    return { ok: false, error: "Escribe la meta solo con números, por ejemplo 3000." };
  }
  if (target === null || Number(target) <= 0) return { ok: false, error: "Escribe cuánta comisión quieres ganar este mes." };
  if (Number(target) > GOAL_MAX) return { ok: false, error: "Esa meta es demasiado grande. Revisa el número." };
  const user = await db.user.findUnique({ where: { id: userId }, select: { currency: true } });
  if (!user) return { ok: false, error: "No encontré tu cuenta. Vuelve a entrar." };
  // DayKey text, cast in SQL: a JS Date would shift with the session time zone
  const month = bogotaMonth(opts.now ?? new Date());
  await db.$executeRaw`
    INSERT INTO "MonthlyGoal" ("id", "userId", "month", "targetCommission", "currency", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${userId}, ${month}::date, ${target}::numeric, ${user.currency}, now(), now())
    ON CONFLICT ("userId", "month") DO UPDATE SET
      "targetCommission" = EXCLUDED."targetCommission",
      "currency" = EXCLUDED."currency",
      "updatedAt" = now()
  `;
  invalidate(userId, WRITE_EFFECTS.setGoal(), opts.revalidate);
  return { ok: true };
}

/** «Tu camino»: the option the person picked. Ownership and month in the WHERE. */
export async function chooseGoalPath(db: Db, userId: string, chosen: ChosenPath, opts: WriteOpts = {}): Promise<WriteResult> {
  const month = bogotaMonth(opts.now ?? new Date());
  const n = await db.$executeRaw`
    UPDATE "MonthlyGoal" SET "chosenPath" = ${JSON.stringify(chosen)}::jsonb, "updatedAt" = now()
    WHERE "userId" = ${userId} AND "month" = ${month}::date
  `;
  if (n === 0) return { ok: false, error: "Primero ponte una meta para este mes." };
  invalidate(userId, WRITE_EFFECTS.chooseGoalPath(), opts.revalidate);
  return { ok: true };
}

function parseTarget(raw: string) {
  const t = raw.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n <= WEEK_TARGET_MAX ? n : null;
}

/** «Esta semana»: the targets the person confirmed (suggestions are never saved on their own). */
export async function setWeeklyGoal(
  db: Db,
  userId: string,
  input: { meetingsTarget: string; followupsTarget: string },
  opts: WriteOpts = {},
): Promise<WriteResult> {
  const meetings = parseTarget(input.meetingsTarget);
  const followups = parseTarget(input.followupsTarget);
  if (meetings === null || followups === null) {
    return { ok: false, error: "Escribe cuántas reuniones y cuántos seguimientos quieres hacer esta semana (números enteros)." };
  }
  const week = weekStartOf(bogotaDay(opts.now ?? new Date()));
  await db.$executeRaw`
    INSERT INTO "WeeklyGoal" ("id", "userId", "weekStart", "meetingsTarget", "followupsTarget", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${userId}, ${week}::date, ${meetings}, ${followups}, now(), now())
    ON CONFLICT ("userId", "weekStart") DO UPDATE SET
      "meetingsTarget" = EXCLUDED."meetingsTarget",
      "followupsTarget" = EXCLUDED."followupsTarget",
      "updatedAt" = now()
  `;
  invalidate(userId, WRITE_EFFECTS.setWeeklyGoal(), opts.revalidate);
  return { ok: true };
}
