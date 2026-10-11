// Ingestion writes (plan PR 5). Every statement is single and idempotent
// (Neon HTTP: no interactive transactions, no updateMany/deleteMany/createMany,
// no nested writes); ownership is always in the WHERE.
//
// The transcript is written ONCE here (CallTranscript) and read back only by
// retryCallBrief, which runs when the person taps «Reintentar». Screens never
// read it; the fresh brief uses the text still in memory from the ingest.
import type { PrismaClient } from "@prisma/client";
import { normalizeName } from "@/lib/text/name-norm";
import { WRITE_EFFECTS } from "@/lib/read/tags";
import { bogotaDay } from "@/lib/time/bogota";
import {
  BRIEF_VERSION,
  type BriefInput,
  type CallBrief,
  type ModelCall,
  type Outcome,
  isSalesCall,
  runCallBrief,
} from "@/lib/ingest/brief";
import type { IngestInput, Invitee } from "@/lib/ingest/meeting";
import { proposalsFor } from "@/lib/ingest/proposals";
import { backfillWindowDays } from "@/lib/ingest/window";
import { encryptSecret } from "@/lib/secret-crypto";
import { invalidate } from "./invalidate";
import type { WriteOpts } from "./offers";
import { recountCounters } from "./recount";

type Db = PrismaClient;

/** timestamp(3) columns hold UTC wall time (same convention as recount.ts) */
const ts = (d: Date) => d.toISOString().replace("Z", "");

export type IngestResult = { ok: true; callId: string; created: boolean } | { ok: false; error: string };

/**
 * Stores one call: Call (PROCESSING) + CallTranscript, once. A repeated webhook
 * or a page seen twice hits the unique (userId, source, sourceId) and changes
 * nothing. The brief is a separate step (briefIngestedCall) so the webhook can
 * answer Fathom first and brief after the response.
 */
export async function ingestCall(db: Db, userId: string, input: IngestInput, opts: WriteOpts = {}): Promise<IngestResult> {
  // Point 6: a Fathom meeting can arrive first without recording_id (sourceId
  // "url:…", the docs payload) and later with it. Same user + same shareUrl, or
  // same title + recordedAt, is the same meeting: keep ONE row.
  const fathomUrlId = input.source === "FATHOM" && input.sourceId.startsWith("url:");
  if (input.source === "FATHOM" && !fathomUrlId) {
    const adopted = await db.$executeRaw`
      UPDATE "Call" SET "sourceId" = ${input.sourceId},
        "summaryEn" = COALESCE("summaryEn", ${input.summaryEn}),
        "actionItemsEn" = COALESCE("actionItemsEn", ${input.actionItemsEn}), "updatedAt" = now()
      WHERE "id" = (
        SELECT c."id" FROM "Call" c
        WHERE c."userId" = ${userId} AND c."source" = 'FATHOM' AND c."sourceId" LIKE 'url:%'
          AND (c."shareUrl" = ${input.shareUrl} OR (c."title" = ${input.title} AND c."recordedAt" = ${ts(input.recordedAt)}::timestamp))
          AND NOT EXISTS (SELECT 1 FROM "Call" d WHERE d."userId" = ${userId} AND d."source" = 'FATHOM' AND d."sourceId" = ${input.sourceId})
        ORDER BY c."createdAt" LIMIT 1
      ) AND "userId" = ${userId}
    `;
    if (adopted > 0) {
      const same = await db.call.findUnique({
        where: { userId_source_sourceId: { userId, source: "FATHOM", sourceId: input.sourceId } },
        select: { id: true },
      });
      if (!same) return { ok: false, error: "No pude guardar la llamada." };
      if (input.transcriptText) await storeTranscript(db, userId, same.id, input.transcriptText);
      return { ok: true, callId: same.id, created: false };
    }
  }
  const inserted = fathomUrlId
    ? await db.$executeRaw`
        INSERT INTO "Call" ("id", "userId", "source", "sourceId", "title", "shareUrl", "recordedAt", "durationSec",
          "summaryEn", "actionItemsEn", "state", "createdAt", "updatedAt")
        SELECT gen_random_uuid()::text, ${userId}, 'FATHOM'::"CallSource", ${input.sourceId}, ${input.title},
          ${input.shareUrl}, ${ts(input.recordedAt)}::timestamp, ${input.durationSec}::int, ${input.summaryEn},
          ${input.actionItemsEn}, 'PROCESSING', now(), now()
        WHERE NOT EXISTS (
          SELECT 1 FROM "Call" c WHERE c."userId" = ${userId} AND c."source" = 'FATHOM'
            AND (c."shareUrl" = ${input.shareUrl} OR (c."title" = ${input.title} AND c."recordedAt" = ${ts(input.recordedAt)}::timestamp))
        )
        ON CONFLICT ("userId", "source", "sourceId") DO NOTHING
      `
    : await db.$executeRaw`
        INSERT INTO "Call" ("id", "userId", "source", "sourceId", "title", "shareUrl", "recordedAt", "durationSec",
          "summaryEn", "actionItemsEn", "state", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, ${userId}, ${input.source}::"CallSource", ${input.sourceId}, ${input.title},
          ${input.shareUrl}, ${ts(input.recordedAt)}::timestamp, ${input.durationSec}::int, ${input.summaryEn},
          ${input.actionItemsEn}, 'PROCESSING', now(), now())
        ON CONFLICT ("userId", "source", "sourceId") DO NOTHING
      `;
  const call =
    (await db.call.findUnique({
      where: { userId_source_sourceId: { userId, source: input.source, sourceId: input.sourceId } },
      select: { id: true },
    })) ??
    (fathomUrlId
      ? await db.call.findFirst({
          where: {
            userId,
            source: "FATHOM",
            OR: [...(input.shareUrl ? [{ shareUrl: input.shareUrl }] : []), { title: input.title, recordedAt: input.recordedAt }],
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        })
      : null);
  if (!call) return { ok: false, error: "No pude guardar la llamada." };
  if (inserted > 0 && input.transcriptText) await storeTranscript(db, userId, call.id, input.transcriptText);
  if (inserted > 0) {
    await recountCounters(db, userId, bogotaDay(opts.now ?? new Date()));
    invalidate(userId, WRITE_EFFECTS.ingestCall(), opts.revalidate);
  }
  return { ok: true, callId: call.id, created: inserted > 0 };
}

async function storeTranscript(db: Db, userId: string, callId: string, text: string) {
  await db.$executeRaw`
    INSERT INTO "CallTranscript" ("callId", "userId", "text", "charCount")
    VALUES (${callId}, ${userId}, ${text}, ${text.length}::int)
    ON CONFLICT ("callId") DO NOTHING
  `;
}

export type BriefDeps = { model: ModelCall | null };
export type BriefOutcome = { ok: true; state: "PENDING_CONFIRM" | "IGNORED" } | { ok: false; reason: string };

/** Fresh brief right after ingestCall, from the text still in memory (no transcript read). */
export async function briefIngestedCall(
  db: Db,
  userId: string,
  callId: string,
  input: IngestInput,
  deps: BriefDeps,
  opts: WriteOpts = {},
): Promise<BriefOutcome> {
  const out = await briefAndStore(db, userId, callId, {
    title: input.title,
    recordedAt: input.recordedAt,
    invitees: input.invitees,
    summaryEn: input.summaryEn,
    actionItemsEn: input.actionItemsEn,
    transcriptText: input.transcriptText,
  }, deps, opts.now);
  invalidate(userId, WRITE_EFFECTS.briefIngestedCall(), opts.revalidate);
  return out;
}

/**
 * «Reintentar» on a call whose brief failed (or stayed processing): the only
 * place that reads CallTranscript back (manual reprocess, plan 1.1).
 */
export async function retryCallBrief(db: Db, userId: string, callId: string, deps: BriefDeps, opts: WriteOpts = {}): Promise<BriefOutcome> {
  const call = await db.call.findFirst({
    where: { id: callId, userId, state: { in: ["BRIEF_FAILED", "PROCESSING"] } },
    select: { id: true, title: true, recordedAt: true, summaryEn: true, actionItemsEn: true, transcript: { select: { text: true } } },
  });
  if (!call) return { ok: false, reason: "NOT_FOUND" };
  const out = await briefAndStore(db, userId, call.id, {
    title: call.title,
    recordedAt: call.recordedAt,
    invitees: [],
    summaryEn: call.summaryEn,
    actionItemsEn: call.actionItemsEn,
    transcriptText: call.transcript?.text ?? null,
  }, deps, opts.now);
  invalidate(userId, WRITE_EFFECTS.retryCallBrief(), opts.revalidate);
  return out;
}

type BriefSource = Omit<BriefInput, "callDay" | "offers"> & { recordedAt: Date };

async function briefAndStore(db: Db, userId: string, callId: string, src: BriefSource, deps: BriefDeps, now = new Date()): Promise<BriefOutcome> {
  const [offers, current] = await Promise.all([
    db.offer.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "asc" }, take: 30, select: { id: true, name: true, currency: true } }),
    db.call.findFirst({ where: { id: callId, userId }, select: { briefVersion: true, recordedAt: true } }),
  ]);
  if (!current) return { ok: false, reason: "NOT_FOUND" };
  const result = await runCallBrief(
    { ...src, callDay: bogotaDay(src.recordedAt), offers: offers.map((o) => ({ name: o.name, currency: o.currency })) },
    deps.model,
  );
  const today = bogotaDay(now);
  if (!result.ok) {
    await db.$executeRaw`
      UPDATE "Call" SET "state" = 'BRIEF_FAILED', "briefAttempts" = "briefAttempts" + 1, "updatedAt" = now()
      WHERE "id" = ${callId} AND "userId" = ${userId} AND "state" IN ('PROCESSING', 'BRIEF_FAILED')
    `;
    await recountCounters(db, userId, today);
    return { ok: false, reason: result.reason };
  }
  const { brief, outcome, oneLine } = result;
  const version = current.briefVersion + 1;
  const sales = isSalesCall(brief);
  // internal or non-sales meetings (team calls) do not wait for confirmation
  const state = sales ? "PENDING_CONFIRM" : "IGNORED";
  const n = await db.$executeRaw`
    UPDATE "Call" SET "brief" = ${JSON.stringify({ v: BRIEF_VERSION, ...brief })}::jsonb, "briefVersion" = ${version}::int,
      "oneLine" = ${oneLine}, "suggestedOutcome" = ${outcome}::"CallOutcome", "state" = ${state}::"CallState", "updatedAt" = now()
    WHERE "id" = ${callId} AND "userId" = ${userId} AND "state" IN ('PROCESSING', 'BRIEF_FAILED')
  `;
  if (n === 0) return { ok: false, reason: "ALREADY_DONE" };
  const offerId = offers.find((o) => brief.producto && normalizeName(o.name) === normalizeName(brief.producto))?.id ?? null;
  await storeObjections(db, userId, callId, offerId, current.recordedAt, sales ? brief.objeciones : []);
  await storeInsights(db, userId, callId, sales ? brief.aprendizajes : []);
  if (sales) await proposeChanges(db, userId, callId, version, brief, outcome, src.invitees, offerId);
  await recountCounters(db, userId, today);
  return { ok: true, state };
}

async function storeObjections(db: Db, userId: string, callId: string, offerId: string | null, at: Date, labels: string[]) {
  await db.$executeRaw`DELETE FROM "CallObjection" WHERE "callId" = ${callId} AND "userId" = ${userId}`;
  if (!labels.length) return;
  await db.$executeRaw`
    INSERT INTO "CallObjection" ("id", "userId", "callId", "offerId", "label", "at")
    SELECT gen_random_uuid()::text, ${userId}, ${callId}, ${offerId}, x, ${ts(at)}::timestamp
    FROM unnest(${labels}::text[]) AS x
  `;
}

async function storeInsights(db: Db, userId: string, callId: string, items: CallBrief["aprendizajes"]) {
  await db.$executeRaw`DELETE FROM "CoachInsight" WHERE "callId" = ${callId} AND "userId" = ${userId}`;
  if (!items.length) return;
  await db.$executeRaw`
    INSERT INTO "CoachInsight" ("id", "userId", "callId", "kind", "text", "createdAt")
    SELECT gen_random_uuid()::text, ${userId}, ${callId}, t.kind::"CoachInsightKind", t.text, now()
    FROM unnest(${items.map((i) => i.tipo)}::text[], ${items.map((i) => i.texto)}::text[]) AS t(kind, text)
  `;
}

/** Lead candidates: same guest email or same normalized name. Never merged automatically. */
async function matchLeads(db: Db, userId: string, emails: string[], names: string[]) {
  if (!emails.length && !names.length) return [];
  return db.lead.findMany({
    where: {
      userId,
      OR: [
        ...(emails.length ? [{ email: { in: emails, mode: "insensitive" as const } }] : []),
        ...(names.length ? [{ nameNorm: { in: names } }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 3,
    select: { id: true, name: true },
  });
}

async function proposeChanges(
  db: Db, userId: string, callId: string, version: number, brief: CallBrief,
  outcome: Outcome | null, invitees: Invitee[], offerId: string | null,
) {
  const emails = [...new Set([brief.email, ...invitees.map((i) => i.email)].filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase()))];
  const names = [...new Set([brief.cliente_real, ...invitees.map((i) => i.name)].filter((n): n is string => Boolean(n)).map(normalizeName).filter(Boolean))];
  const matches = await matchLeads(db, userId, emails, names);
  for (const p of proposalsFor(brief, outcome, invitees, matches, offerId)) {
    await db.$executeRaw`
      INSERT INTO "ProposedChange" ("id", "userId", "leadId", "callId", "origin", "kind", "payload", "preview", "status", "idempotencyKey", "createdAt")
      VALUES (gen_random_uuid()::text, ${userId}, ${p.leadId}, ${callId}, 'BRIEF', ${p.kind}::"ChangeKind",
        ${JSON.stringify(p.payload)}::jsonb, ${p.preview}, 'PENDING', ${`call:${callId}:v${version}:${p.kind}`}, now())
      ON CONFLICT ("idempotencyKey") DO NOTHING
    `;
  }
}

// ---------- Fathom connection ----------

export type WebhookFields = { id: string; secret: string; token: string; url: string };

/**
 * «Conectar Fathom»: key saved encrypted and the rebuild starts. `webhook`:
 * the one this deployment just created, or "keep" to leave the stored webhook
 * fields exactly as they are (no webhook created here, e.g. a preview).
 */
export async function saveFathomConnection(
  db: Db,
  userId: string,
  conn: { apiKey: string; webhook: WebhookFields | "keep" },
  opts: WriteOpts = {},
) {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - backfillWindowDays() * 86_400_000);
  const apiKeyEnc = encryptSecret(conn.apiKey);
  const keep = conn.webhook === "keep";
  const hook = conn.webhook === "keep" ? null : conn.webhook;
  const secretEnc = hook ? encryptSecret(hook.secret) : null;
  await db.$executeRaw`
    INSERT INTO "FathomConnection" ("id", "userId", "apiKeyEnc", "webhookId", "webhookSecretEnc", "webhookToken", "webhookUrl",
      "importSince", "backfillCursor", "backfillStatus", "backfillUntil", "backfillLockedUntil", "backfillImported", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${userId}, ${apiKeyEnc}, ${hook?.id ?? null}, ${secretEnc}, ${hook?.token ?? null}, ${hook?.url ?? null},
      ${ts(since)}::timestamp, NULL, 'RUNNING', ${ts(now)}::timestamp, NULL, 0, now(), now())
    ON CONFLICT ("userId") DO UPDATE SET
      "apiKeyEnc" = EXCLUDED."apiKeyEnc",
      "webhookId" = CASE WHEN ${keep} THEN "FathomConnection"."webhookId" ELSE EXCLUDED."webhookId" END,
      "webhookSecretEnc" = CASE WHEN ${keep} THEN "FathomConnection"."webhookSecretEnc" ELSE EXCLUDED."webhookSecretEnc" END,
      "webhookToken" = CASE WHEN ${keep} THEN "FathomConnection"."webhookToken" ELSE EXCLUDED."webhookToken" END,
      "webhookUrl" = CASE WHEN ${keep} THEN "FathomConnection"."webhookUrl" ELSE EXCLUDED."webhookUrl" END,
      "importSince" = EXCLUDED."importSince", "backfillCursor" = NULL,
      "backfillStatus" = 'RUNNING', "backfillUntil" = EXCLUDED."backfillUntil", "backfillLockedUntil" = NULL,
      "backfillImported" = 0, "updatedAt" = now()
  `;
  invalidate(userId, WRITE_EFFECTS.saveFathomConnection(), opts.revalidate);
  return { ok: true as const };
}

/** «Desconectar»: the key and webhook go; the calls already brought stay. */
export async function disconnectFathom(db: Db, userId: string, opts: WriteOpts = {}) {
  await db.$executeRaw`DELETE FROM "FathomConnection" WHERE "userId" = ${userId}`;
  invalidate(userId, WRITE_EFFECTS.disconnectFathom(), opts.revalidate);
  return { ok: true as const };
}

/**
 * One burst at a time: takes the connection until `until` only if the rebuild
 * is running and nobody holds it (or the Retry-After pause is over).
 */
export async function claimBackfill(db: Db, userId: string, now: Date, until: Date) {
  const n = await db.$executeRaw`
    UPDATE "FathomConnection" SET "backfillLockedUntil" = ${ts(until)}::timestamp, "updatedAt" = now()
    WHERE "userId" = ${userId} AND "backfillStatus" = 'RUNNING'
      AND ("backfillLockedUntil" IS NULL OR "backfillLockedUntil" <= ${ts(now)}::timestamp)
  `;
  return n > 0;
}

/** After each page: cursor, status, count, and when the next burst may start (null = right away). */
export async function saveBackfillProgress(
  db: Db,
  userId: string,
  p: { cursor: string | null; status: "RUNNING" | "DONE" | "ERROR"; imported: number; lockedUntil: Date | null },
  opts: WriteOpts = {},
) {
  await db.$executeRaw`
    UPDATE "FathomConnection" SET "backfillCursor" = ${p.cursor}, "backfillStatus" = ${p.status}::"BackfillStatus",
      "backfillImported" = "backfillImported" + ${p.imported}::int,
      "backfillLockedUntil" = ${p.lockedUntil ? ts(p.lockedUntil) : null}::timestamp,
      "lastSyncAt" = now(), "updatedAt" = now()
    WHERE "userId" = ${userId}
  `;
  invalidate(userId, WRITE_EFFECTS.saveBackfillProgress(), opts.revalidate);
}
