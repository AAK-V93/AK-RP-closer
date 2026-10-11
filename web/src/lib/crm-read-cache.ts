import type { PrismaClient } from "@prisma/client";
import { zonedDayKey } from "@/lib/crm-time";

/**
 * Short per-instance cache for the CRM rollup (crmDashboard), so Inicio → CRM → back does not
 * re-read every call, lead, alert and follow-up each time (Neon Free: 5 GB of transfer a month).
 *
 * It stays correct after «Guardar» and across server instances: before reusing a result it asks
 * Postgres for a tiny fingerprint (row count + sum of each row's xmin, which changes on every
 * insert/update/delete) of every table the rollup reads. Any write → new fingerprint → recompute.
 * The TTL only bounds how stale time-based buckets (vence hoy / vencido) can be.
 */
export const CRM_CACHE_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 200;

type Entry = { at: number; day: string; fingerprint: string; value: unknown };
const entries = new Map<string, Entry>();

/** One small query (a few hundred bytes back) that changes whenever the user's CRM data changes. */
export async function crmFingerprint(prisma: PrismaClient, userId: string) {
  const rows = await prisma.$queryRaw<{ fp: string }[]>`
    SELECT concat_ws('|',
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM "CallRecord" WHERE "userId" = ${userId}),
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM "Lead" WHERE "userId" = ${userId}),
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM "LeadAlert" WHERE "userId" = ${userId}),
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM "Commission" WHERE "userId" = ${userId}),
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM "FollowupThread" WHERE "userId" = ${userId}),
      (SELECT count(*) || ':' || coalesce(sum(t.xmin::text::bigint), 0) FROM "FollowupTouch" t
         JOIN "FollowupThread" th ON th."id" = t."threadId" WHERE th."userId" = ${userId}),
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM "UserOffer" WHERE "userId" = ${userId}),
      (SELECT count(*) || ':' || coalesce(sum(m.xmin::text::bigint), 0) FROM "CoachMessage" m
         JOIN "CoachProfile" p ON p."id" = m."profileId" WHERE p."userId" = ${userId} AND m."thread" = 'hub'),
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM "User" WHERE "id" = ${userId}),
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM "FollowupLibraryScript"),
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM "FollowupPack"),
      (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM "PracticeSession" WHERE "userId" = ${userId})
    ) AS fp
  `;
  return String(rows[0]?.fp || "");
}

/**
 * Reuse `compute()`'s last result for this key while the fingerprint, the day and the TTL hold.
 * The fingerprint is read BEFORE computing, so a write that lands during the computation still
 * invalidates the entry. If the fingerprint can't be read, it just computes (no caching).
 */
export async function cachedCrmRead<T>(
  prisma: PrismaClient,
  userId: string,
  key: string,
  compute: () => Promise<T>,
  now = new Date(),
): Promise<T> {
  let fingerprint = "";
  try {
    fingerprint = await crmFingerprint(prisma, userId);
  } catch (error) {
    console.error("crm fingerprint", error);
    return compute();
  }
  const id = `${userId}:${key}`;
  const day = zonedDayKey(now);
  const hit = entries.get(id);
  if (hit && hit.fingerprint === fingerprint && hit.day === day && now.getTime() - hit.at < CRM_CACHE_TTL_MS) {
    return structuredClone(hit.value) as T;
  }
  const value = await compute();
  if (fingerprint) {
    let copy: unknown;
    try {
      copy = structuredClone(value);
    } catch {
      return value; // not cloneable: don't cache
    }
    entries.delete(id);
    entries.set(id, { at: now.getTime(), day, fingerprint, value: copy });
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  }
  return value;
}

/** For writes in this instance that want the next read to recompute right away. */
export function forgetCrmReads(userId: string) {
  for (const id of [...entries.keys()]) if (id.startsWith(`${userId}:`)) entries.delete(id);
}

export function crmReadCacheSize() {
  return entries.size;
}
