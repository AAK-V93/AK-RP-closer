// «Reintentar»: re-brief up to RETRY_TAKE calls whose brief failed (or stayed
// processing). Only on the person's tap; never on a schedule.
import type { PrismaClient } from "@prisma/client";
import { readCallsToRetry } from "@/lib/read/fathom";
import { retryCallBrief } from "@/lib/write/ingest";
import type { WriteOpts } from "@/lib/write/offers";
import { type ModelCall, briefModelAvailable, defaultBriefModel } from "./brief";

export const RETRY_TAKE = 3;

export async function retryFailedBriefs(
  db: PrismaClient,
  userId: string,
  deps: { model?: ModelCall | null; revalidate?: WriteOpts["revalidate"]; now?: Date } = {},
) {
  const now = deps.now ?? new Date();
  const model = deps.model !== undefined ? deps.model : briefModelAvailable() ? defaultBriefModel : null;
  const calls = await readCallsToRetry(db, userId, now, RETRY_TAKE);
  const results = await Promise.all(calls.map((c) => retryCallBrief(db, userId, c.id, { model }, { revalidate: deps.revalidate, now })));
  return { tried: calls.length, fixed: results.filter((r) => r.ok).length };
}
