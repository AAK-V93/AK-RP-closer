// Bounded, idempotent recounts (plan 2.2). Each function is ONE SQL statement
// that recounts only the affected row from the source tables, so it is atomic
// on the Neon HTTP driver (no interactive transactions), corrects itself if a
// previous write was lost, and never runs at read time.
//
// Money columns of UserMonthStats (salesTotal, cashCollected, commissionEarned)
// come from ACTIVO Deals closed in the month (PR 6) and sum only amounts in
// User.currency (other currencies are «por confirmar»). A null amount adds 0.
import type { PrismaClient } from "@prisma/client";
import { type DayKey, BOGOTA, addDaysKey, monthRange, startOfDayInstant } from "@/lib/time/bogota";

type Db = Pick<PrismaClient, "$executeRaw">;

/** timestamp(3) columns hold UTC wall time; compare against a UTC literal, never the session zone. */
const ts = (d: Date) => d.toISOString().replace("Z", "");

/**
 * Lead.attemptsSinceLastCall = live ATTEMPT events (not undone) after the last
 * call (or since the lead was created); lastContactAt = the later of the last
 * call and the last live attempt (an undone attempt gives it back exactly).
 */
export async function recountLeadAttempts(db: Db, leadId: string) {
  return db.$executeRaw`
    UPDATE "Lead" l SET
      "attemptsSinceLastCall" = a.n,
      "lastContactAt" = CASE WHEN a.last IS NULL THEN l."lastCallAt" ELSE GREATEST(l."lastCallAt", a.last) END,
      "updatedAt" = now()
    FROM (
      SELECT
        (SELECT count(*)::int FROM "LeadEvent" e
          WHERE e."leadId" = x.id AND e.type = 'ATTEMPT' AND e."undoneAt" IS NULL
            AND e."at" > COALESCE(x."lastCallAt", x."createdAt")) AS n,
        (SELECT max(e."at") FROM "LeadEvent" e
          WHERE e."leadId" = x.id AND e.type = 'ATTEMPT' AND e."undoneAt" IS NULL) AS last
      FROM "Lead" x WHERE x.id = ${leadId}
    ) a
    WHERE l.id = ${leadId}
  `;
}

/** UserMonthStats for (user, month), all offers (offerId NULL). */
export async function recountMonthAll(db: Db, userId: string, month: DayKey, timeZone = BOGOTA) {
  const r = monthRange(month, timeZone);
  const [start, end] = [ts(r.start), ts(r.end)];
  return db.$executeRaw`
    INSERT INTO "UserMonthStats"
      ("id", "userId", "month", "offerId", "callsHeld", "closedCount", "lostCount", "attemptsCount",
       "salesTotal", "cashCollected", "commissionEarned", "updatedAt")
    SELECT gen_random_uuid()::text, ${userId}, ${r.month}::date, NULL,
      (SELECT count(*)::int FROM "Call" c
        WHERE c."userId" = ${userId} AND c.state = 'CONFIRMED'
          AND c."recordedAt" >= ${start}::timestamp AND c."recordedAt" < ${end}::timestamp),
      (SELECT count(*)::int FROM "Lead" l
        WHERE l."userId" = ${userId} AND l.status = 'CERRADO'
          AND l."closedAt" >= ${start}::timestamp AND l."closedAt" < ${end}::timestamp),
      (SELECT count(*)::int FROM "Lead" l
        WHERE l."userId" = ${userId} AND l.status = 'PERDIDO'
          AND l."lostAt" >= ${start}::timestamp AND l."lostAt" < ${end}::timestamp),
      (SELECT count(*)::int FROM "LeadEvent" e
        WHERE e."userId" = ${userId} AND e.type = 'ATTEMPT' AND e."undoneAt" IS NULL
          AND e."at" >= ${start}::timestamp AND e."at" < ${end}::timestamp),
      m.sales, m.cash, m.commission,
      now()
    FROM (
      SELECT COALESCE(sum(d."amountTotal"), 0) AS sales, COALESCE(sum(d."cashCollected"), 0) AS cash,
        COALESCE(sum(d."commissionAmount"), 0) AS commission
      FROM "Deal" d JOIN "User" u ON u.id = d."userId" AND u.currency = d.currency
      WHERE d."userId" = ${userId} AND d.status = 'ACTIVO'
        AND d."closedAt" >= ${start}::timestamp AND d."closedAt" < ${end}::timestamp
    ) m
    ON CONFLICT ("userId", "month") WHERE "offerId" IS NULL DO UPDATE SET
      "callsHeld" = EXCLUDED."callsHeld",
      "closedCount" = EXCLUDED."closedCount",
      "lostCount" = EXCLUDED."lostCount",
      "attemptsCount" = EXCLUDED."attemptsCount",
      "salesTotal" = EXCLUDED."salesTotal",
      "cashCollected" = EXCLUDED."cashCollected",
      "commissionEarned" = EXCLUDED."commissionEarned",
      "updatedAt" = now()
  `;
}

/** UserMonthStats for (user, month, offer). Attempts belong to the offer of their lead. */
export async function recountMonthOffer(db: Db, userId: string, month: DayKey, offerId: string, timeZone = BOGOTA) {
  const r = monthRange(month, timeZone);
  const [start, end] = [ts(r.start), ts(r.end)];
  return db.$executeRaw`
    INSERT INTO "UserMonthStats"
      ("id", "userId", "month", "offerId", "callsHeld", "closedCount", "lostCount", "attemptsCount",
       "salesTotal", "cashCollected", "commissionEarned", "updatedAt")
    SELECT gen_random_uuid()::text, ${userId}, ${r.month}::date, ${offerId},
      (SELECT count(*)::int FROM "Call" c
        WHERE c."userId" = ${userId} AND c."offerId" = ${offerId} AND c.state = 'CONFIRMED'
          AND c."recordedAt" >= ${start}::timestamp AND c."recordedAt" < ${end}::timestamp),
      (SELECT count(*)::int FROM "Lead" l
        WHERE l."userId" = ${userId} AND l."offerId" = ${offerId} AND l.status = 'CERRADO'
          AND l."closedAt" >= ${start}::timestamp AND l."closedAt" < ${end}::timestamp),
      (SELECT count(*)::int FROM "Lead" l
        WHERE l."userId" = ${userId} AND l."offerId" = ${offerId} AND l.status = 'PERDIDO'
          AND l."lostAt" >= ${start}::timestamp AND l."lostAt" < ${end}::timestamp),
      (SELECT count(*)::int FROM "LeadEvent" e JOIN "Lead" l ON l.id = e."leadId"
        WHERE e."userId" = ${userId} AND l."offerId" = ${offerId} AND e.type = 'ATTEMPT' AND e."undoneAt" IS NULL
          AND e."at" >= ${start}::timestamp AND e."at" < ${end}::timestamp),
      m.sales, m.cash, m.commission,
      now()
    FROM (
      SELECT COALESCE(sum(d."amountTotal"), 0) AS sales, COALESCE(sum(d."cashCollected"), 0) AS cash,
        COALESCE(sum(d."commissionAmount"), 0) AS commission
      FROM "Deal" d JOIN "User" u ON u.id = d."userId" AND u.currency = d.currency
      WHERE d."userId" = ${userId} AND d."offerId" = ${offerId} AND d.status = 'ACTIVO'
        AND d."closedAt" >= ${start}::timestamp AND d."closedAt" < ${end}::timestamp
    ) m
    WHERE EXISTS (SELECT 1 FROM "Offer" o WHERE o.id = ${offerId} AND o."userId" = ${userId})
    ON CONFLICT ("userId", "month", "offerId") DO UPDATE SET
      "callsHeld" = EXCLUDED."callsHeld",
      "closedCount" = EXCLUDED."closedCount",
      "lostCount" = EXCLUDED."lostCount",
      "attemptsCount" = EXCLUDED."attemptsCount",
      "salesTotal" = EXCLUDED."salesTotal",
      "cashCollected" = EXCLUDED."cashCollected",
      "commissionEarned" = EXCLUDED."commissionEarned",
      "updatedAt" = now()
  `;
}

/** «decidiendo» = still in follow-up after a call that ended in SEGUIMIENTO more than this many local days ago. */
export const DECIDING_DAYS = 14;

/**
 * UserCounters for the user: banner, «en seguimiento», último cierre and
 * llamadas desde el último cierre (both from the last ACTIVE Deal, PR 6), «Ignoradas (N)» and the top objection of the last 5
 * lost-or-deciding calls. A deciding call (Arquitectura, PR 2 review) is the
 * last call of a lead in SEGUIMIENTO whose outcome was SEGUIMIENTO and whose
 * Bogotá day is more than 14 days before `today`.
 */
export async function recountCounters(db: Db, userId: string, today: DayKey, timeZone = BOGOTA) {
  const decidingBefore = ts(startOfDayInstant(addDaysKey(today, -DECIDING_DAYS), timeZone));
  return db.$executeRaw`
    WITH last_close AS (
      -- the last ACTIVE sale (PR 6): an undone or annulled deal does not count
      SELECT d."closedAt", l.name FROM "Deal" d JOIN "Lead" l ON l.id = d."leadId"
      WHERE d."userId" = ${userId} AND d.status = 'ACTIVO'
      ORDER BY d."closedAt" DESC, d.id DESC LIMIT 1
    ), lost AS (
      SELECT c.id FROM "Call" c
      WHERE c."userId" = ${userId}
        AND (
          c.outcome = 'PERDIDO'
          OR (c.outcome = 'SEGUIMIENTO' AND c.id IN (
            SELECT l."lastCallId" FROM "Lead" l
            WHERE l."userId" = ${userId} AND l.status = 'SEGUIMIENTO'
              AND l."lastCallId" IS NOT NULL
              AND l."lastCallAt" < ${decidingBefore}::timestamp
          ))
        )
      ORDER BY c."recordedAt" DESC, c.id DESC LIMIT 5
    ), top_obj AS (
      SELECT o.label, count(DISTINCT o."callId")::int AS hits
      FROM "CallObjection" o JOIN lost ON lost.id = o."callId"
      GROUP BY o.label ORDER BY hits DESC, o.label ASC LIMIT 1
    )
    INSERT INTO "UserCounters" (
      "userId", "pendingConfirmCount", "followingCount", "lastCloseAt", "lastCloseLeadName",
      "callsSinceLastClose", "topObjectionLabel", "topObjectionHits", "topObjectionOf", "ignoredCount", "updatedAt")
    SELECT ${userId},
      (SELECT count(*)::int FROM "Call" c WHERE c."userId" = ${userId} AND c.state = 'PENDING_CONFIRM'),
      (SELECT count(*)::int FROM "Lead" l WHERE l."userId" = ${userId} AND l.status = 'SEGUIMIENTO'),
      (SELECT "closedAt" FROM last_close),
      (SELECT name FROM last_close),
      (SELECT count(*)::int FROM "Call" c
        WHERE c."userId" = ${userId} AND c.state = 'CONFIRMED'
          AND c."recordedAt" > COALESCE((SELECT "closedAt" FROM last_close), '-infinity'::timestamp)),
      (SELECT label FROM top_obj),
      (SELECT hits FROM top_obj),
      (SELECT NULLIF(count(*), 0)::int FROM lost),
      (SELECT count(*)::int FROM "Call" c WHERE c."userId" = ${userId} AND c.state = 'IGNORED'),
      now()
    ON CONFLICT ("userId") DO UPDATE SET
      "pendingConfirmCount" = EXCLUDED."pendingConfirmCount",
      "followingCount" = EXCLUDED."followingCount",
      "lastCloseAt" = EXCLUDED."lastCloseAt",
      "lastCloseLeadName" = EXCLUDED."lastCloseLeadName",
      "callsSinceLastClose" = EXCLUDED."callsSinceLastClose",
      "topObjectionLabel" = EXCLUDED."topObjectionLabel",
      "topObjectionHits" = EXCLUDED."topObjectionHits",
      "topObjectionOf" = EXCLUDED."topObjectionOf",
      "ignoredCount" = EXCLUDED."ignoredCount",
      "updatedAt" = now()
  `;
}

export type RecountScope = {
  /** local day of the write (from lib/time/bogota) */
  today: DayKey;
  /** months touched by the write (YYYY-MM-01); default: the current one */
  months?: DayKey[];
  /** offer of the touched rows, for the per-offer stats row */
  offerId?: string | null;
  /** lead whose attempt counter changed */
  leadId?: string | null;
  timeZone?: string;
};

/**
 * Recount after a write: only the touched (user, month), (user, month, offer),
 * UserCounters and, if given, the lead's attempt counter. Sequential single
 * statements; each is idempotent, so a retry is always safe.
 */
export async function recount(db: Db, userId: string, scope: RecountScope) {
  const tz = scope.timeZone ?? BOGOTA;
  const months = [...new Set(scope.months?.length ? scope.months : [`${scope.today.slice(0, 7)}-01`])];
  if (scope.leadId) await recountLeadAttempts(db, scope.leadId);
  await recountCounters(db, userId, scope.today, tz);
  for (const month of months) {
    await recountMonthAll(db, userId, month, tz);
    if (scope.offerId) await recountMonthOffer(db, userId, month, scope.offerId, tz);
  }
}
