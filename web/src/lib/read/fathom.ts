// Fathom connection reads for ingestion (not cached: the webhook and the burst
// need the current row). Secrets stay encrypted here; callers decrypt.
import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "fathomConnection" | "call">;

/** POST /api/fathom/webhook/[token]: the payload has no user, the token in the URL says whose it is. */
export async function readWebhookTarget(db: Db, token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  return db.fathomConnection.findFirst({
    where: { webhookToken: token },
    select: { userId: true, webhookSecretEnc: true },
  });
}

export async function readFathomConnection(db: Db, userId: string) {
  return db.fathomConnection.findUnique({
    where: { userId },
    select: {
      apiKeyEnc: true, webhookId: true, webhookUrl: true, importSince: true, backfillCursor: true,
      backfillStatus: true, backfillLockedUntil: true, backfillImported: true,
    },
  });
}

/** Calls whose brief failed, or that stayed «processing» (the request ended first), for «Reintentar». */
export async function readCallsToRetry(db: Db, userId: string, now: Date, take = 3) {
  const stale = new Date(now.getTime() - 10 * 60_000);
  return db.call.findMany({
    where: {
      userId,
      OR: [{ state: "BRIEF_FAILED" }, { state: "PROCESSING", createdAt: { lt: stale } }],
    },
    orderBy: { recordedAt: "desc" },
    take: Math.min(take, 10),
    select: { id: true },
  });
}
