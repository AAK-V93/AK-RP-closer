// Rebuild of the last BACKFILL_WINDOW_DAYS in bursts (plan 2.6). No cron, no
// polling: a burst runs when the person taps «Conectar Fathom» and then once per
// visit to Hoy while the rebuild is RUNNING (both after the response).
// Each burst: lease → up to PAGES_PER_BURST pages of /meetings → ingest + brief
// → save cursor. A 429 stops the burst and the lease waits Retry-After.
import type { PrismaClient } from "@prisma/client";
import { readFathomConnection } from "@/lib/read/fathom";
import { decryptSecret } from "@/lib/secret-crypto";
import { briefIngestedCall, claimBackfill, ingestCall, saveBackfillProgress } from "@/lib/write/ingest";
import type { WriteOpts } from "@/lib/write/offers";
import { type ModelCall, briefModelAvailable, defaultBriefModel } from "./brief";
import { type FathomClient, FathomError, FathomRateLimited, fathomClient } from "./fathom-api";
import { fromFathomMeeting } from "./meeting";

export { BACKFILL_WINDOW_DAYS } from "@/lib/write/ingest";
export const PAGES_PER_BURST = 3;
/** do not start another page after this (the brief of a page runs in parallel) */
export const BURST_BUDGET_MS = 25_000;
/** a burst holds the connection at most this long */
export const LEASE_MS = 90_000;
/** after an unexpected Fathom error, the next visit may try again after this */
const ERROR_PAUSE_MS = 60_000;

export type BurstDeps = {
  client?: FathomClient;
  model?: ModelCall | null;
  now?: () => Date;
  revalidate?: WriteOpts["revalidate"];
};

export type BurstResult =
  | { ran: false; reason: "NOT_RUNNING_OR_BUSY" | "NO_CONNECTION" }
  | { ran: true; pages: number; imported: number; status: "RUNNING" | "DONE" | "ERROR"; retryAfterSec?: number };

export async function runBackfillBurst(db: PrismaClient, userId: string, deps: BurstDeps = {}): Promise<BurstResult> {
  const clock = deps.now ?? (() => new Date());
  const started = clock();
  if (!(await claimBackfill(db, userId, started, new Date(started.getTime() + LEASE_MS)))) {
    return { ran: false, reason: "NOT_RUNNING_OR_BUSY" };
  }
  const conn = await readFathomConnection(db, userId);
  if (!conn?.apiKeyEnc) return { ran: false, reason: "NO_CONNECTION" };
  const client = deps.client ?? fathomClient(decryptSecret(conn.apiKeyEnc));
  const model = deps.model !== undefined ? deps.model : briefModelAvailable() ? defaultBriefModel : null;
  const opts = { revalidate: deps.revalidate };
  const createdAfter = (conn.importSince ?? new Date(started.getTime() - 60 * 86_400_000)).toISOString();

  let cursor = conn.backfillCursor;
  let pages = 0;
  let imported = 0;
  while (pages < PAGES_PER_BURST && clock().getTime() - started.getTime() < BURST_BUDGET_MS) {
    let page;
    try {
      page = await client.listMeetings({ createdAfter, cursor });
    } catch (error) {
      if (error instanceof FathomRateLimited) {
        const until = new Date(clock().getTime() + error.retryAfterSec * 1000);
        await saveBackfillProgress(db, userId, { cursor, status: "RUNNING", imported: 0, lockedUntil: until }, opts);
        return { ran: true, pages, imported, status: "RUNNING", retryAfterSec: error.retryAfterSec };
      }
      const auth = error instanceof FathomError && (error.status === 401 || error.status === 403);
      console.warn("[fathom] backfill page failed:", error instanceof FathomError ? error.status : "unknown");
      const status = auth ? "ERROR" : "RUNNING";
      await saveBackfillProgress(db, userId, {
        cursor, status, imported: 0, lockedUntil: auth ? null : new Date(clock().getTime() + ERROR_PAUSE_MS),
      }, opts);
      return { ran: true, pages, imported, status };
    }
    pages += 1;
    let created = 0;
    const briefs: Array<Promise<unknown>> = [];
    for (const meeting of page.items) {
      const input = fromFathomMeeting(meeting, clock());
      if (!input) continue;
      const saved = await ingestCall(db, userId, input, { ...opts, now: clock() });
      if (!saved.ok || !saved.created) continue;
      created += 1;
      briefs.push(briefIngestedCall(db, userId, saved.callId, input, { model }, { ...opts, now: clock() }));
    }
    await Promise.allSettled(briefs);
    imported += created;
    cursor = page.nextCursor;
    const done = !cursor;
    const last = done || pages >= PAGES_PER_BURST || clock().getTime() - started.getTime() >= BURST_BUDGET_MS;
    await saveBackfillProgress(db, userId, {
      cursor, status: done ? "DONE" : "RUNNING", imported: created, lockedUntil: last ? null : new Date(clock().getTime() + LEASE_MS),
    }, opts);
    if (done) return { ran: true, pages, imported, status: "DONE" };
  }
  return { ran: true, pages, imported, status: "RUNNING" };
}
