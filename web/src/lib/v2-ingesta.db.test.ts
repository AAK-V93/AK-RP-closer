// PR 5 (ingesta) on a local throwaway Postgres only (same refusal rules as the
// other *.db.test.ts files). Fathom is a fake client and the model a mock:
// nothing here calls Fathom or Gemini, and no real key is used.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { runBackfillBurst } from "@/lib/ingest/backfill";
import { connectFathom, disconnectFathomFlow } from "@/lib/ingest/connect";
import { type FathomClient, FathomError, FathomRateLimited, type FathomMeeting } from "@/lib/ingest/fathom-api";
import { retryFailedBriefs } from "@/lib/ingest/retry";
import { uploadCall } from "@/lib/ingest/upload";
import { handleFathomWebhook } from "@/lib/ingest/webhook";
import { readGoals, readStartSteps } from "@/lib/read/goals";
import { readOffersPage } from "@/lib/read/offers";
import { bogotaDay } from "@/lib/time/bogota";
import { saveFathomConnection } from "@/lib/write/ingest";
import { upsertOffer } from "@/lib/write/offers";
import { TEST_WEBHOOK_SECRET, briefJson, mockModel, signedHeaders } from "@/lib/ingest/__fixtures__/helpers";

process.env.AUTH_SECRET ||= "local-test-only-auth-secret";

const WEB = path.resolve(__dirname, "../..");
const FIX = path.join(__dirname, "ingest/__fixtures__");
const raw = (name: string) => readFileSync(path.join(FIX, name), "utf8");
const fixture = (name: string) => JSON.parse(raw(name)) as FathomMeeting;
const url = process.env.TEST_DATABASE_URL?.trim() ?? "";
const hostOf = (r: string) => {
  try {
    const u = new URL(r);
    return u.searchParams.get("host") || u.hostname;
  } catch {
    return "";
  }
};
const isLocal = (r: string) => /^(localhost|127\.0\.0\.1|\/)/.test(hostOf(r)) && !/neon/i.test(r);
const skip = !url ? "set TEST_DATABASE_URL to a local throwaway Postgres" : !isLocal(url) ? "refusing: only localhost is allowed" : false;

let db: PrismaClient;
const tagsSeen: string[] = [];
const revalidate = (t: string) => void tagsSeen.push(t);
const NOW = new Date("2026-10-11T15:00:00Z");

async function newUser(tag: string) {
  return (await db.user.create({ data: { email: `ingesta-${tag}-${Date.now()}-${Math.random()}@example.test` }, select: { id: true } })).id;
}

/** A connection row as «Conectar» leaves it, with a known test webhook secret. */
async function connected(userId: string, token: string) {
  await saveFathomConnection(db, userId, { apiKey: "fake-key", webhook: { id: "wh_test", secret: TEST_WEBHOOK_SECRET, token, url: `https://closer.example/api/fathom/webhook/${token}` } }, { revalidate, now: NOW });
}
const token = () => `tok_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 32).padEnd(24, "x");

async function counts(userId: string) {
  const [calls, transcripts, changes, objections, insights] = await Promise.all([
    db.call.findMany({ where: { userId }, select: { id: true, state: true, sourceId: true, durationSec: true, briefAttempts: true, oneLine: true, suggestedOutcome: true }, take: 50 }),
    db.callTranscript.findMany({ where: { userId }, select: { callId: true, charCount: true }, take: 50 }),
    db.proposedChange.findMany({ where: { userId }, select: { kind: true, leadId: true, idempotencyKey: true, origin: true, status: true }, take: 50 }),
    db.callObjection.findMany({ where: { userId }, select: { label: true }, take: 50 }),
    db.coachInsight.findMany({ where: { userId }, select: { kind: true, text: true }, take: 50 }),
  ]);
  return { calls, transcripts, changes, objections, insights };
}

before(async () => {
  if (skip) return;
  execFileSync(path.join(WEB, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: WEB, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  db = new PrismaClient({ datasourceUrl: url });
});

after(async () => {
  await db?.$disconnect();
});

test("webhook: signed, stored once, brief after the response; a repeated webhook duplicates nothing", { skip }, async () => {
  const userId = await newUser("hook");
  const tok = token();
  await connected(userId, tok);
  await upsertOffer(db, userId, { name: "Mentoría 90 días", currency: "USD", commissionType: "PER_CLOSE", commissionValue: "300" }, { revalidate });
  const body = raw("fathom-meeting-es.json");
  const h = signedHeaders(body, { id: "msg_same" });
  const { model, prompts } = mockModel(briefJson());

  tagsSeen.length = 0;
  const first = await handleFathomWebhook(db, tok, h, body, { model, revalidate });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { ok: true });
  assert.ok(first.later, "brief runs after the response");
  let c = await counts(userId);
  assert.deepEqual(c.calls.map((x) => [x.state, x.sourceId, x.durationSec]), [["PROCESSING", "987654321", 3150]]);
  assert.equal(c.transcripts.length, 1);
  // nothing revalidated before the response: the brief after it does (Next drops an after()
  // revalidation of a tag the same request already revalidated)
  assert.equal(tagsSeen.length, 0);

  // the brief uses the text in memory: even with the stored transcript gone it still sees the tail
  const kept = await db.callTranscript.findUniqueOrThrow({ where: { callId: c.calls[0].id }, select: { text: true } });
  await db.callTranscript.delete({ where: { callId: c.calls[0].id } });
  await first.later!();
  for (const t of ["pending", "practice", "stats"]) assert.ok(tagsSeen.includes(`u:${userId}:${t}`), t);
  assert.match(prompts[0], /\[00:50:02\] Laura Gómez: Sí, el viernes a las 3/);
  await db.callTranscript.create({ data: { callId: c.calls[0].id, userId, text: kept.text, charCount: kept.text.length } });

  c = await counts(userId);
  assert.equal(c.calls[0].state, "PENDING_CONFIRM");
  assert.equal(c.calls[0].suggestedOutcome, "SEGUIMIENTO");
  assert.match(c.calls[0].oneLine!, /esposo/);
  assert.deepEqual(c.changes.map((x) => [x.kind, x.origin, x.status]), [["CREATE_LEAD", "BRIEF", "PENDING"]]);
  assert.deepEqual(c.objections.map((o) => o.label), ["Lo tiene que consultar"]);
  assert.deepEqual(c.insights.map((i) => i.kind).sort(), ["BIEN", "MEJORAR"]);
  const counters = await db.userCounters.findUniqueOrThrow({ where: { userId }, select: { pendingConfirmCount: true } });
  assert.equal(counters.pendingConfirmCount, 1);
  const stored = await db.call.findUniqueOrThrow({ where: { id: c.calls[0].id }, select: { brief: true, briefVersion: true, summaryEn: true, actionItemsEn: true } });
  assert.equal((stored.brief as { venta_total: number }).venta_total, 2000);
  assert.equal(stored.briefVersion, 1);
  assert.match(stored.actionItemsEn!, /Send Laura the payment link/);

  // Fathom resends (same webhook-id), or sends the same recording again (new id): nothing changes
  const again = await handleFathomWebhook(db, tok, h, body, { model, revalidate });
  assert.deepEqual([again.status, again.body, again.later], [200, { ok: true, duplicate: true }, undefined]);
  const third = await handleFathomWebhook(db, tok, signedHeaders(body), body, { model, revalidate });
  assert.equal(third.body.duplicate, true);
  const after3 = await counts(userId);
  assert.equal(after3.calls.length, 1);
  assert.equal(after3.transcripts.length, 1);
  assert.equal(after3.changes.length, 1);
  assert.equal(after3.objections.length, 1);
  assert.equal(prompts.length, 1);
});

test("webhook: wrong signature 401, unknown token 404, the docs example without recording_id is stored by its link", { skip }, async () => {
  const userId = await newUser("hook2");
  const tok = token();
  await connected(userId, tok);
  const body = raw("fathom-webhook-docs.json");
  const bad = signedHeaders(body, { secret: `whsec_${Buffer.from("otra-clave").toString("base64")}` });
  assert.equal((await handleFathomWebhook(db, tok, bad, body, { model: null, revalidate })).status, 401);
  assert.equal((await handleFathomWebhook(db, "tok_does_not_exist_000000", signedHeaders(body), body, { model: null, revalidate })).status, 404);
  assert.equal((await counts(userId)).calls.length, 0);
  const ok = await handleFathomWebhook(db, tok, signedHeaders(body), body, { model: null, revalidate });
  assert.equal(ok.status, 200);
  await ok.later!();
  const c = await counts(userId);
  assert.deepEqual(c.calls.map((x) => [x.sourceId, x.state, x.briefAttempts]), [["url:https://fathom.video/share/xyz123", "BRIEF_FAILED", 1]]);
});

test("null summary → Spanish brief from the transcript; model failure → BRIEF_FAILED, «Reintentar» fixes it", { skip }, async () => {
  const userId = await newUser("null");
  const tok = token();
  await connected(userId, tok);
  const body = raw("fathom-meeting-null-summary.json");
  const failing = mockModel(new Error("503 overloaded"));
  const r = await handleFathomWebhook(db, tok, signedHeaders(body), body, { model: failing.model, revalidate });
  await r.later!();
  let c = await counts(userId);
  assert.deepEqual(c.calls.map((x) => [x.state, x.briefAttempts, x.durationSec]), [["BRIEF_FAILED", 1, 2467]]);
  assert.equal(c.changes.length, 0);
  const page = await readOffersPage(db, userId);
  assert.deepEqual(page.calls, { processing: 0, failed: 1 });

  // «Reintentar»: the only path that reads the stored transcript back
  const good = mockModel(briefJson({ cliente_real: "Pedro Ruiz", estado_lead: "perdido", razon_no_cierre: "No es el momento", citas: [], venta_total: null, objeciones: ["No es el momento"] }));
  tagsSeen.length = 0;
  assert.deepEqual(await retryFailedBriefs(db, userId, { model: good.model, revalidate, now: NOW }), { tried: 1, fixed: 1 });
  assert.match(good.prompts[0], /RESUMEN_FATHOM\n\(no hay/);
  assert.match(good.prompts[0], /\[00:41:07\] Pedro Ruiz: Que cierre el contrato grande/);
  c = await counts(userId);
  assert.equal(c.calls[0].state, "PENDING_CONFIRM");
  assert.equal(c.calls[0].suggestedOutcome, "PERDIDO");
  assert.deepEqual(c.changes.map((x) => x.kind).sort(), ["CREATE_LEAD", "SET_STATUS"]);
  const b = await db.call.findUniqueOrThrow({ where: { id: c.calls[0].id }, select: { brief: true } });
  assert.ok((b.brief as { faltantes: string[] }).faltantes.includes("resumen_fathom"));
  assert.ok(tagsSeen.includes(`u:${userId}:pending`));
  assert.deepEqual(await retryFailedBriefs(db, userId, { model: good.model, revalidate, now: NOW }), { tried: 0, fixed: 0 });
});

test("English call: matches an existing person by guest email (suggests an update, never merges); internal calls are set aside", { skip }, async () => {
  const userId = await newUser("en");
  const tok = token();
  await connected(userId, tok);
  const lead = await db.lead.create({ data: { userId, name: "John Smith", nameNorm: "john smith", email: "John.Smith@client.com" }, select: { id: true } });
  const body = raw("fathom-meeting-en.json");
  const { model } = mockModel(briefJson({ cliente_real: "John Smith", estado_lead: "cerrado", una_linea: "John aceptó la propuesta y pagó en la llamada." }));
  const r = await handleFathomWebhook(db, tok, signedHeaders(body), body, { model, revalidate });
  await r.later!();
  const c = await counts(userId);
  assert.deepEqual(c.changes.map((x) => [x.kind, x.leadId]).sort(), [["SET_STATUS", lead.id], ["UPDATE_LEAD", lead.id]]);
  const l = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { status: true, oneLine: true } });
  assert.deepEqual(l, { status: "SEGUIMIENTO", oneLine: null }); // nothing applied until she confirms

  const internal = await newUser("internal");
  const tok2 = token();
  await connected(internal, tok2);
  const m2 = mockModel(briefJson({ estado_agenda: "INTERNA", estado_lead: null }));
  const r2 = await handleFathomWebhook(db, tok2, signedHeaders(body), body, { model: m2.model, revalidate });
  await r2.later!();
  const c2 = await counts(internal);
  assert.equal(c2.calls[0].state, "IGNORED");
  assert.equal(c2.changes.length + c2.objections.length + c2.insights.length, 0);
});

function fakeFathom(pages: Array<{ items: FathomMeeting[]; nextCursor: string | null } | Error>) {
  const seen: Array<{ createdAfter: string; cursor?: string | null }> = [];
  const hooks: string[] = [];
  const deleted: string[] = [];
  let i = 0;
  const client: FathomClient = {
    async listMeetings(q) {
      seen.push(q);
      const p = pages[Math.min(i, pages.length - 1)];
      i += 1;
      if (p instanceof Error) throw p;
      return p;
    },
    async checkKey() {},
    async createWebhook(u) {
      hooks.push(u);
      return { id: `wh_${hooks.length}`, secret: TEST_WEBHOOK_SECRET };
    },
    async deleteWebhook(id) {
      deleted.push(id);
    },
  };
  return { client, seen, hooks, deleted, reset: (next: typeof pages) => { pages = next; i = 0; } };
}

test("rebuild in bursts: ≤2 pages, cursor saved, 429 waits Retry-After, a second visit does not overlap, then DONE", { skip }, async () => {
  const userId = await newUser("burst");
  await connected(userId, token());
  const es = fixture("fathom-meeting-es.json");
  const nul = fixture("fathom-meeting-null-summary.json");
  const en = fixture("fathom-meeting-en.json");
  const fake = fakeFathom([
    { items: [es, nul], nextCursor: "c2" },
    new FathomRateLimited(120),
  ]);
  const { model, prompts } = mockModel(briefJson());
  let clock = NOW.getTime();
  const now = () => new Date(clock);

  tagsSeen.length = 0;
  const r1 = await runBackfillBurst(db, userId, { client: fake.client, model, now, revalidate });
  // the burst runs in after() of «Conectar», which revalidated offers: progress goes to its own tag
  assert.ok(tagsSeen.includes(`u:${userId}:fathom`));
  assert.ok(!tagsSeen.includes(`u:${userId}:offers`));
  assert.deepEqual(r1, { ran: true, pages: 1, imported: 2, status: "RUNNING", retryAfterSec: 120 });
  assert.equal(fake.seen.length, 2);
  assert.equal(fake.seen[0].createdAfter, new Date(NOW.getTime() - 60 * 86_400_000).toISOString());
  assert.deepEqual(fake.seen.map((s) => s.cursor ?? null), [null, "c2"]);
  assert.equal(prompts.length, 2);
  let conn = await db.fathomConnection.findUniqueOrThrow({ where: { userId }, select: { backfillCursor: true, backfillStatus: true, backfillLockedUntil: true, backfillImported: true } });
  assert.equal(conn.backfillCursor, "c2");
  assert.equal(conn.backfillStatus, "RUNNING");
  assert.equal(conn.backfillImported, 2);
  assert.equal(conn.backfillLockedUntil!.getTime(), NOW.getTime() + 120_000);

  // another visit during the pause: no request at all
  clock += 60_000;
  assert.deepEqual(await runBackfillBurst(db, userId, { client: fake.client, model, now, revalidate }), { ran: false, reason: "NOT_RUNNING_OR_BUSY" });
  assert.equal(fake.seen.length, 2);

  // after Retry-After: the last page, then DONE
  clock += 61_000;
  fake.reset([{ items: [en, es], nextCursor: null }]);
  const r3 = await runBackfillBurst(db, userId, { client: fake.client, model, now, revalidate });
  assert.deepEqual(r3, { ran: true, pages: 1, imported: 1, status: "DONE" });
  assert.equal(fake.seen.at(-1)!.cursor, "c2");
  assert.equal(prompts.length, 3); // es twice in the pages → stored and briefed once
  conn = await db.fathomConnection.findUniqueOrThrow({ where: { userId }, select: { backfillCursor: true, backfillStatus: true, backfillLockedUntil: true, backfillImported: true } });
  assert.deepEqual(conn, { backfillCursor: null, backfillStatus: "DONE", backfillLockedUntil: null, backfillImported: 3 });
  assert.deepEqual(await runBackfillBurst(db, userId, { client: fake.client, model, now, revalidate }), { ran: false, reason: "NOT_RUNNING_OR_BUSY" });
  const c = await counts(userId);
  assert.equal(c.calls.length, 3);
  assert.equal(c.transcripts.length, 3);
  assert.equal((await readStartSteps(db, userId, "2026-10-01")).backfill, "DONE");
});

test("rebuild: two full pages per burst at most (PAGES_PER_BURST); a revoked key stops it (ERROR), no loop", { skip }, async () => {
  const userId = await newUser("burst2");
  await connected(userId, token());
  const pageOf = (n: number) => ({ items: [{ ...fixture("fathom-meeting-null-summary.json"), recording_id: 7000 + n }], nextCursor: `p${n + 1}` });
  const fake = fakeFathom([pageOf(1), pageOf(2), pageOf(3), pageOf(4)]);
  const r = await runBackfillBurst(db, userId, { client: fake.client, model: null, now: () => NOW, revalidate });
  assert.deepEqual(r, { ran: true, pages: 2, imported: 2, status: "RUNNING" });
  assert.equal(fake.seen.length, 2);
  fake.reset([new FathomError("Fathom 401", 401)]);
  const r2 = await runBackfillBurst(db, userId, { client: fake.client, model: null, now: () => NOW, revalidate });
  assert.deepEqual(r2, { ran: true, pages: 0, imported: 0, status: "ERROR" });
  assert.equal(fake.seen.length, 3);
  const page = await readOffersPage(db, userId);
  assert.equal(page.fathom.backfill, "ERROR");
});

test("connect: key checked, our old webhook removed, ours created per user, saved encrypted, 60-day window, offers tag revalidated", { skip }, async () => {
  const userId = await newUser("connect");
  const fake = fakeFathom([{ items: [], nextCursor: null }]);
  tagsSeen.length = 0;
  const r = await connectFathom(db, userId, "fake-key-0123456789", { clientFor: () => fake.client, baseUrl: "https://closer.example", production: true, revalidate, now: NOW });
  assert.deepEqual(r, { ok: true, webhook: true });
  assert.equal(fake.hooks.length, 1);
  assert.match(fake.hooks[0], /^https:\/\/closer\.example\/api\/fathom\/webhook\/[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(tagsSeen, [`u:${userId}:offers`]);
  const row = await db.fathomConnection.findUniqueOrThrow({ where: { userId }, select: { apiKeyEnc: true, webhookId: true, webhookSecretEnc: true, webhookToken: true, webhookUrl: true, importSince: true, backfillStatus: true } });
  assert.equal(row.webhookUrl, fake.hooks[0]);
  assert.notEqual(row.apiKeyEnc, "fake-key-0123456789");
  assert.ok(!row.webhookSecretEnc!.includes("whsec_"));
  assert.equal(row.webhookId, "wh_1");
  assert.equal(fake.hooks[0].endsWith(row.webhookToken!), true);
  assert.equal(row.importSince!.getTime(), NOW.getTime() - 60 * 86_400_000);
  assert.equal(row.backfillStatus, "RUNNING");
  const steps = await readStartSteps(db, userId, "2026-10-01");
  assert.equal(steps.backfill, "RUNNING");

  // reconnect: the previous webhook goes first, then a new one with a new token
  const again = await connectFathom(db, userId, "fake-key-9876543210", { clientFor: () => fake.client, baseUrl: "https://closer.example", production: true, now: NOW, revalidate });
  assert.deepEqual(again, { ok: true, webhook: true });
  assert.deepEqual(fake.deleted, ["wh_1"]);
  const row2 = await db.fathomConnection.findUniqueOrThrow({ where: { userId }, select: { webhookId: true, webhookToken: true } });
  assert.equal(row2.webhookId, "wh_2");
  assert.notEqual(row2.webhookToken, row.webhookToken);

  // a bad key changes nothing; production without a public URL is refused
  const rejecting: FathomClient = { ...fake.client, async checkKey() { throw new FathomError("Fathom 401", 401); } };
  const bad = await connectFathom(db, userId, "revoked-key-000000", { clientFor: () => rejecting, baseUrl: "https://closer.example", production: true, revalidate });
  assert.equal(bad.ok, false);
  assert.match((bad as { error: string }).error, /Esa clave no funcionó/);
  assert.equal((await connectFathom(db, userId, "fake-key-0123456789", { clientFor: () => fake.client, baseUrl: "http://localhost:3000", production: true, revalidate })).ok, false);
  assert.equal((await db.fathomConnection.findUniqueOrThrow({ where: { userId }, select: { webhookId: true } })).webhookId, "wh_2");

  // disconnect: webhook removed, row gone, the URL answers 404 from now on
  await disconnectFathomFlow(db, userId, { clientFor: () => fake.client, baseUrl: "https://closer.example", revalidate });
  assert.deepEqual(fake.deleted, ["wh_1", "wh_2"]);
  assert.equal(await db.fathomConnection.findUnique({ where: { userId }, select: { id: true } }), null);
  const body = raw("fathom-meeting-es.json");
  assert.equal((await handleFathomWebhook(db, row2.webhookToken!, signedHeaders(body), body, { model: null, revalidate })).status, 404);
});

test("BLOCKER: a webhook of another deployment (other domain) or one this database never stored is never deleted", { skip }, async () => {
  // production created wh_prod on its own domain and that row is in this database (shared DB worst case)
  const userId = await newUser("foreign");
  await saveFathomConnection(db, userId, { apiKey: "prod-key-0123456789", webhook: { id: "wh_prod", secret: TEST_WEBHOOK_SECRET, token: "tok_prod_000000000000000000", url: "https://closer.app/api/fathom/webhook/tok_prod_000000000000000000" } }, { revalidate, now: NOW });
  const fake = fakeFathom([{ items: [], nextCursor: null }]);
  const preview = "https://ak-rp-closer-git-v2.vercel.app";
  // reconnect from a preview with webhooks enabled: wh_prod stays, ours is created
  const r = await connectFathom(db, userId, "prod-key-0123456789", { clientFor: () => fake.client, baseUrl: preview, production: true, webhooks: true, revalidate, now: NOW });
  assert.deepEqual(r, { ok: true, webhook: true });
  assert.deepEqual(fake.deleted, []);
  // reconnect from that preview again: only the preview's own webhook goes
  await connectFathom(db, userId, "prod-key-0123456789", { clientFor: () => fake.client, baseUrl: preview, production: true, webhooks: true, revalidate, now: NOW });
  assert.deepEqual(fake.deleted, ["wh_1"]);
  // disconnect from production's domain: the stored webhook is the preview's → not ours → kept
  await disconnectFathomFlow(db, userId, { clientFor: () => fake.client, baseUrl: "https://closer.app", revalidate });
  assert.deepEqual(fake.deleted, ["wh_1"]);
  assert.equal(await db.fathomConnection.findUnique({ where: { userId }, select: { id: true } }), null);

  // nothing stored → nothing deleted (we never list the account's webhooks)
  const other = await newUser("foreign2");
  const fake2 = fakeFathom([{ items: [], nextCursor: null }]);
  await connectFathom(db, other, "prod-key-0123456789", { clientFor: () => fake2.client, baseUrl: preview, production: true, webhooks: true, revalidate, now: NOW });
  await disconnectFathomFlow(db, other, { clientFor: () => fake2.client, baseUrl: "https://closer.app", revalidate });
  assert.deepEqual(fake2.deleted, []);
  const client = fake2.client as Record<string, unknown>;
  assert.equal(typeof client.listWebhooks, "undefined");
});

test("preview (VERCEL_ENV=preview): no webhook unless FATHOM_WEBHOOK_IN_PREVIEW=1; the stored one is kept; the rebuild still runs", { skip }, async () => {
  const userId = await newUser("preview");
  await saveFathomConnection(db, userId, { apiKey: "prod-key-0123456789", webhook: { id: "wh_prod", secret: TEST_WEBHOOK_SECRET, token: "tok_prod_111111111111111111", url: "https://closer.app/api/fathom/webhook/tok_prod_111111111111111111" } }, { revalidate, now: NOW });
  const en = fixture("fathom-meeting-en.json");
  const fake = fakeFathom([{ items: [en], nextCursor: null }]);
  const saved = { VERCEL_ENV: process.env.VERCEL_ENV, FLAG: process.env.FATHOM_WEBHOOK_IN_PREVIEW };
  process.env.VERCEL_ENV = "preview";
  delete process.env.FATHOM_WEBHOOK_IN_PREVIEW;
  try {
    const r = await connectFathom(db, userId, "prod-key-0123456789", { clientFor: () => fake.client, baseUrl: "http://no-public-url", production: true, revalidate, now: NOW });
    assert.deepEqual(r, { ok: true, webhook: false });
    assert.deepEqual([fake.hooks, fake.deleted], [[], []]);
    const row = await db.fathomConnection.findUniqueOrThrow({ where: { userId }, select: { webhookId: true, webhookUrl: true, backfillStatus: true } });
    assert.deepEqual(row, { webhookId: "wh_prod", webhookUrl: "https://closer.app/api/fathom/webhook/tok_prod_111111111111111111", backfillStatus: "RUNNING" });
    const burst = await runBackfillBurst(db, userId, { client: fake.client, model: null, now: () => NOW, revalidate });
    assert.deepEqual(burst, { ran: true, pages: 1, imported: 1, status: "DONE" });
    const fresh = await newUser("preview2");
    const r2 = await connectFathom(db, fresh, "prod-key-0123456789", { clientFor: () => fake.client, baseUrl: "http://no-public-url", production: true, revalidate, now: NOW });
    assert.deepEqual(r2, { ok: true, webhook: false });
    assert.equal((await readOffersPage(db, fresh)).fathom.webhook, false);
    process.env.FATHOM_WEBHOOK_IN_PREVIEW = "1";
    const r3 = await connectFathom(db, fresh, "prod-key-0123456789", { clientFor: () => fake.client, baseUrl: "https://ak-rp-closer-git-v2.vercel.app", production: true, revalidate, now: NOW });
    assert.deepEqual(r3, { ok: true, webhook: true });
    assert.equal((await readOffersPage(db, fresh)).fathom.webhook, true);
  } finally {
    if (saved.VERCEL_ENV === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = saved.VERCEL_ENV;
    if (saved.FLAG === undefined) delete process.env.FATHOM_WEBHOOK_IN_PREVIEW; else process.env.FATHOM_WEBHOOK_IN_PREVIEW = saved.FLAG;
  }
});

test("point 6: the same meeting without recording_id and later with it stays ONE row (both orders, link or title + time)", { skip }, async () => {
  const docs = fixture("fathom-webhook-docs.json");
  const en = fixture("fathom-meeting-en.json");
  // docs (url:) first, then en (recording_id): the row adopts the id
  const a = await newUser("p6a");
  const tokA = token();
  await connected(a, tokA);
  for (const m of [docs, en]) {
    const body = JSON.stringify(m);
    const res = await handleFathomWebhook(db, tokA, signedHeaders(body), body, { model: null, revalidate });
    if (res.later) await res.later();
  }
  const ca = await counts(a);
  assert.deepEqual(ca.calls.map((x) => x.sourceId), ["123456789"]);
  assert.equal(ca.transcripts.length, 1);

  // en first, then docs: the docs copy is not inserted
  const b = await newUser("p6b");
  const tokB = token();
  await connected(b, tokB);
  for (const m of [en, docs]) {
    const body = JSON.stringify(m);
    const res = await handleFathomWebhook(db, tokB, signedHeaders(body), body, { model: null, revalidate });
    if (res.later) await res.later();
  }
  assert.deepEqual((await counts(b)).calls.map((x) => x.sourceId), ["123456789"]);

  // different link, same title + recordedAt → same meeting
  const c = await newUser("p6c");
  const tokC = token();
  await connected(c, tokC);
  const moved = { ...docs, share_url: "https://fathom.video/share/otro", url: "https://fathom.video/calls/otro" };
  for (const m of [moved, en]) {
    const body = JSON.stringify(m);
    const res = await handleFathomWebhook(db, tokC, signedHeaders(body), body, { model: null, revalidate });
    if (res.later) await res.later();
  }
  assert.deepEqual((await counts(c)).calls.map((x) => x.sourceId), ["123456789"]);

  // another user's row is never touched; a different meeting is a new row
  await connected(a, tokA);
  const other = { ...en, recording_id: 42, share_url: "https://fathom.video/share/zzz", url: "https://fathom.video/calls/zzz", meeting_title: "Otra", title: "Otra", recording_start_time: "2026-10-01T15:00:00Z" };
  const body = JSON.stringify(other);
  await handleFathomWebhook(db, tokA, signedHeaders(body), body, { model: null, revalidate });
  assert.deepEqual((await counts(a)).calls.map((x) => x.sourceId).sort(), ["123456789", "42"]);
  assert.deepEqual((await counts(b)).calls.map((x) => x.sourceId), ["123456789"]);
});

test("upload: transcript text → brief right away; the same text again is a duplicate", { skip }, async () => {
  const userId = await newUser("upload");
  const vtt = "WEBVTT\n\n00:00:02.000 --> 00:00:05.000\n<v Kali>Hola Marta, gracias por venir.\n\n00:33:20.000 --> 00:33:30.000\n<v Marta>Listo, te pago hoy por transferencia los 1.500 dólares.\n";
  const { model, prompts } = mockModel(briefJson({ cliente_real: "Marta", estado_lead: "cerrado", citas: [{ campo: "venta_total", texto: "los 1.500 dólares", timestamp: "00:33:20", fuente: "transcripcion" }], venta_total: 1500 }));
  const file = new File([vtt], "marta.vtt", { type: "text/vtt" });
  const r = await uploadCall(db, userId, { file, text: "", title: "Marta", date: "2026-10-10" }, { model, now: NOW, revalidate });
  assert.deepEqual(r, { ok: true, status: "READY" });
  assert.match(prompts[0], /\[00:33:20\] Marta: Listo, te pago hoy/);
  const dup = await uploadCall(db, userId, { file: null, text: vtt, title: "otro", date: "" }, { model, now: NOW, revalidate });
  assert.deepEqual(dup, { ok: true, status: "DUPLICATE" });
  const c = await counts(userId);
  assert.deepEqual(c.calls.map((x) => [x.state, x.durationSec, x.suggestedOutcome]), [["PENDING_CONFIRM", 2000, "CERRO"]]);
  const rec = await db.call.findFirstOrThrow({ where: { userId }, select: { recordedAt: true, source: true } });
  assert.equal(bogotaDay(rec.recordedAt), "2026-10-10");
  assert.equal(rec.source, "UPLOAD");
  // wrong inputs answer in plain words
  const audio = new File([new Uint8Array([1, 2, 3])], "llamada.mp3");
  const audioResult = await uploadCall(db, userId, { file: audio, text: "", title: "", date: "" }, { model, revalidate });
  assert.equal(audioResult.ok, false);
  assert.match((audioResult as { error: string }).error, /transcripción en texto/);
  assert.equal((await uploadCall(db, userId, { file: null, text: "", title: "", date: "" }, { model, revalidate })).ok, false);
  assert.equal((await uploadCall(db, userId, { file: null, text: vtt, title: "", date: "ayer" }, { model, revalidate })).ok, false);
});

test("answer 1 with data: the follow-ups hint counts people in SEGUIMIENTO under 6 attempts", { skip }, async () => {
  const userId = await newUser("hint");
  const mk = (name: string, attempts: number, status: "SEGUIMIENTO" | "CERRADO" = "SEGUIMIENTO") =>
    db.lead.create({ data: { userId, name, nameNorm: name.toLowerCase(), status, attemptsSinceLastCall: attempts }, select: { id: true } });
  await mk("A", 0);
  await mk("B", 0);
  await mk("C", 4);
  await mk("D", 8);
  await mk("E", 0, "CERRADO");
  await db.userCounters.upsert({ where: { userId }, create: { userId, followingCount: 4 }, update: { followingCount: 4 } });
  const data = await readGoals(db, userId, bogotaDay(NOW), "USD");
  assert.deepEqual(data.attemptGroups, [{ attempts: 0, people: 2 }, { attempts: 4, people: 1 }]);
  const { metasView } = await import("@/lib/metrics");
  const v = metasView(data, [], "USD", NOW);
  // (6 + 6 + 2) / 3 = 4.67 → 5
  assert.deepEqual(v.week.followupsHint, { people: 4, perWeek: 5 });
});
