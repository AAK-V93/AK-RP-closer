// PR 6 (Confirmar + ProposedChange/LeadEvent + Deal mínimo) on a local throwaway
// Postgres only (same refusal rules as the other *.db.test.ts files). Calls
// arrive through the real ingest with a mocked model: nothing calls Gemini or Fathom.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { briefJson, mockModel } from "@/lib/ingest/__fixtures__/helpers";
import type { CallBrief } from "@/lib/ingest/brief";
import type { IngestInput, Invitee } from "@/lib/ingest/meeting";
import { readIgnored, readSaved } from "@/lib/read/confirm";
import { readPending } from "@/lib/read/pending";
import { readTodayHeader } from "@/lib/read/today";
import { startOfDayInstant } from "@/lib/time/bogota";
import { confirmCall, undoProposedChange } from "@/lib/write/confirm";
import { briefIngestedCall, ingestCall, recoverIgnoredCall } from "@/lib/write/ingest";
import { recount } from "@/lib/write/recount";

process.env.AUTH_SECRET ||= "local-test-only-auth-secret";

const WEB = path.resolve(__dirname, "../..");
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

async function newUser(tag: string) {
  return (await db.user.create({ data: { email: `confirmar-${tag}-${Date.now()}-${Math.random()}@example.test` }, select: { id: true } })).id;
}

async function offer(userId: string, name = "Mentoría 90 días", data: { commissionType?: "PER_CLOSE" | "PCT_SALE"; commissionValue?: string } = { commissionType: "PER_CLOSE", commissionValue: "500" }) {
  return (await db.offer.create({ data: { userId, name, ...data }, select: { id: true } })).id;
}

async function lead(userId: string, name: string, extra: { email?: string; offerId?: string } = {}) {
  const nameNorm = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
  return (await db.lead.create({ data: { userId, name, nameNorm, ...extra, createdAt: new Date("2026-09-01T12:00:00Z") }, select: { id: true } })).id;
}

/** A call that went through ingest + brief (mock model) and waits for confirmation. */
async function pendingCall(userId: string, at: string, over: Partial<CallBrief> = {}, invitees: Invitee[] = []) {
  const input: IngestInput = {
    source: "UPLOAD", sourceId: `t-${Math.random().toString(36).slice(2)}`, title: `Llamada ${at.slice(0, 10)}`, shareUrl: null,
    recordedAt: new Date(at), durationSec: 2700, summaryEn: null, actionItemsEn: null,
    transcriptText: "[00:38:02] Laura: cuesta 2.000 dólares de contado", invitees,
  };
  const saved = await ingestCall(db, userId, input, { revalidate, now: NOW });
  assert.ok(saved.ok);
  const { model } = mockModel(briefJson(over));
  await briefIngestedCall(db, userId, saved.callId, input, { model }, { revalidate, now: NOW });
  return saved.callId;
}

async function version(callId: string) {
  return String((await db.call.findUniqueOrThrow({ where: { id: callId }, select: { updatedAt: true } })).updatedAt.getTime());
}

/** Everything a confirmation can change, to compare before / after «Deshacer». */
async function snapshot(userId: string) {
  const [stats, counters, leads, calls, deals, tasks, events, suggestions] = await Promise.all([
    db.userMonthStats.findMany({ where: { userId }, orderBy: [{ month: "asc" }, { offerId: "asc" }], take: 50, select: { month: true, offerId: true, callsHeld: true, closedCount: true, lostCount: true, attemptsCount: true, salesTotal: true, cashCollected: true, commissionEarned: true } }),
    db.userCounters.findUnique({ where: { userId }, select: { pendingConfirmCount: true, followingCount: true, lastCloseAt: true, lastCloseLeadName: true, callsSinceLastClose: true, ignoredCount: true, topObjectionLabel: true } }),
    db.lead.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 50, select: { id: true, name: true, status: true, closedAt: true, lostAt: true, lostReason: true, lastCallId: true, lastCallAt: true, lastContactAt: true, nextContactAt: true, nextMeetingAt: true, oneLine: true, whereLeft: true, decider: true, offerId: true, potentialCommission: true, attemptsSinceLastCall: true } }),
    db.call.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 50, select: { id: true, state: true, outcome: true, confirmedAt: true, leadId: true, offerId: true } }),
    db.deal.findMany({ where: { userId, status: "ACTIVO" }, orderBy: { id: "asc" }, take: 50, select: { id: true } }),
    db.followUpTask.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 50, select: { id: true, kind: true, status: true } }),
    db.leadEvent.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 50, select: { id: true, type: true } }),
    db.proposedChange.findMany({ where: { userId, origin: "BRIEF" }, orderBy: { id: "asc" }, take: 50, select: { id: true, status: true } }),
  ]);
  // a stats row that only holds zeros reads the same as no row (screens show 0 either way)
  const nonZero = stats.filter((m) => m.callsHeld || m.closedCount || m.lostCount || m.attemptsCount || Number(m.salesTotal) || Number(m.cashCollected) || Number(m.commissionEarned));
  return JSON.parse(JSON.stringify({ stats: nonZero, counters, leads, calls, deals, tasks, events, suggestions }));
}

const tagsFor = (userId: string, leadId: string) => [`u:${userId}:stats`, `u:${userId}:pending`, `u:${userId}:leads`, `u:${userId}:lead:${leadId}`];

test("«Sigue en seguimiento» on a «pendiente_pago» call: new person, COBRAR task «Pendiente de pago»; a double tap is one change; «Deshacer» puts back exactly the same", { skip }, async () => {
  const userId = await newUser("pp");
  const offerId = await offer(userId);
  const callId = await pendingCall(userId, "2026-10-08T20:00:00Z", { estado_lead: "pendiente_pago" }, [{ name: "Laura Gómez", email: "laura@example.test" }]);
  const [card] = await readPending(db, userId);
  assert.deepEqual(
    { who: card.who, pendingPayment: card.pendingPayment, suggested: card.suggestedOutcome, offer: card.offerName },
    { who: { kind: "new", name: "Laura Gómez" }, pendingPayment: true, suggested: "SEGUIMIENTO", offer: "Mentoría 90 días" },
  );
  const before = await snapshot(userId);
  assert.equal(before.counters.pendingConfirmCount, 1);

  tagsSeen.length = 0;
  const v = await version(callId);
  // double tap: the same card version twice, at the same time
  const [a, b] = await Promise.all([
    confirmCall(db, userId, { callId, version: v, outcome: "SEGUIMIENTO" }, { revalidate, now: NOW }),
    confirmCall(db, userId, { callId, version: v, outcome: "SEGUIMIENTO" }, { revalidate, now: NOW }),
  ]);
  assert.ok(a.ok && b.ok);
  const changes = await db.proposedChange.findMany({ where: { userId, kind: "CONFIRM_CALL" }, take: 10, select: { id: true, status: true, preview: true, leadId: true } });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].status, "APPLIED");
  assert.equal(changes[0].preview, "Guardado: sigue en seguimiento · pendiente de pago");
  const leadId = changes[0].leadId!;
  const person = await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { name: true, email: true, status: true, offerId: true, lastCallId: true, nextContactAt: true, potentialCommission: true, whereLeft: true } });
  assert.deepEqual({ ...person, potentialCommission: person.potentialCommission?.toString() }, {
    name: "Laura Gómez", email: "laura@example.test", status: "SEGUIMIENTO", offerId, lastCallId: callId,
    nextContactAt: startOfDayInstant("2026-10-09"), potentialCommission: "500", whereLeft: "Reunión el viernes a las 3 con su esposo",
  });
  const tasks = await db.followUpTask.findMany({ where: { userId }, take: 5, select: { kind: true, note: true, status: true, dueDate: true, origin: true } });
  assert.deepEqual(tasks, [{ kind: "COBRAR", note: "Pendiente de pago", status: "OPEN", dueDate: new Date("2026-10-09T00:00:00Z"), origin: "CONFIRM" }]);
  assert.deepEqual((await db.leadEvent.findMany({ where: { userId }, take: 5, select: { type: true } })).map((e) => e.type), ["CALL"]);
  const after1 = await snapshot(userId);
  assert.deepEqual([after1.counters.pendingConfirmCount, after1.counters.followingCount], [0, 1]);
  assert.deepEqual(after1.suggestions.map((s: { status: string }) => s.status), ["APPLIED"]);
  for (const t of tagsFor(userId, leadId)) assert.ok(tagsSeen.includes(t), t);
  assert.deepEqual(await readPending(db, userId), []);
  const saved = await readSaved(db, userId, [callId]);
  assert.deepEqual(saved.map((s) => [s.name, s.saved]), [["Laura Gómez", "Guardado: sigue en seguimiento · pendiente de pago"]]);

  // «Deshacer»: exactly what was there before; a second undo does nothing
  tagsSeen.length = 0;
  const undone = await undoProposedChange(db, userId, changes[0].id, { revalidate, now: NOW });
  assert.ok(undone.ok);
  for (const t of [`u:${userId}:stats`, `u:${userId}:pending`, `u:${userId}:leads`]) assert.ok(tagsSeen.includes(t), t);
  assert.deepEqual(await snapshot(userId), before);
  assert.deepEqual(await undoProposedChange(db, userId, changes[0].id, { revalidate, now: NOW }), { ok: true, changeId: changes[0].id, leadId, already: true });
  assert.deepEqual(await snapshot(userId), before);

  // the card comes back with a new version; tapping it again works
  const again = await confirmCall(db, userId, { callId, version: await version(callId), outcome: "PERDIDO" }, { revalidate, now: NOW });
  assert.ok(again.ok);
  const lost = await db.lead.findFirstOrThrow({ where: { userId }, select: { status: true, lostAt: true } });
  assert.deepEqual(lost, { status: "PERDIDO", lostAt: new Date("2026-10-08T20:00:00Z") });
  assert.equal((await db.followUpTask.findMany({ where: { userId }, take: 5, select: { id: true } })).length, 0);
});

test("«Cerró»: a Deal with the commission frozen; Hoy/Metas numbers; last close and calls since come from the last ACTIVE deal; «Deshacer» restores them", { skip }, async () => {
  const userId = await newUser("close");
  const offerId = await offer(userId);
  const laura = await lead(userId, "Laura Gómez", { email: "laura@example.test", offerId });
  const callA = await pendingCall(userId, "2026-10-05T16:00:00Z", { estado_lead: "cerrado" }, [{ name: "Laura Gómez", email: "laura@example.test" }]);
  const [cardA] = await readPending(db, userId);
  assert.deepEqual(cardA.who, { kind: "lead", leadId: laura, name: "Laura Gómez" });
  assert.equal(cardA.suggestedOutcome, "CERRO");

  const r = await confirmCall(db, userId, {
    callId: callA, version: await version(callA), outcome: "CERRO",
    deal: { amountTotal: "2.000", cashCollected: "2000", paymentMode: "CONTADO" },
  }, { revalidate, now: NOW });
  assert.ok(r.ok);
  const deals = await db.deal.findMany({ where: { userId }, take: 5, select: { leadId: true, offerId: true, callId: true, amountTotal: true, cashCollected: true, commissionAmount: true, currency: true, status: true, paymentMode: true, closedAt: true } });
  assert.deepEqual(deals.map((d) => ({ ...d, amountTotal: d.amountTotal?.toString(), cashCollected: d.cashCollected?.toString(), commissionAmount: d.commissionAmount?.toString() })), [{
    leadId: laura, offerId, callId: callA, amountTotal: "2000", cashCollected: "2000", commissionAmount: "500",
    currency: "USD", status: "ACTIVO", paymentMode: "CONTADO", closedAt: new Date("2026-10-05T16:00:00Z"),
  }]);
  const header = await readTodayHeader(db, userId, "2026-10-01");
  assert.deepEqual(header.stats, { callsHeld: 1, closedCount: 1, lostCount: 0, commissionEarned: "500" });
  assert.equal(header.counters?.lastCloseLeadName, "Laura Gómez");
  assert.equal(header.counters?.callsSinceLastClose, 0);
  const perOffer = await db.userMonthStats.findFirstOrThrow({ where: { userId, offerId }, select: { salesTotal: true, commissionEarned: true, closedCount: true } });
  assert.deepEqual([perOffer.salesTotal.toString(), perOffer.commissionEarned.toString(), perOffer.closedCount], ["2000", "500", 1]);

  // the commission is frozen: changing the offer later does not change this sale
  await db.offer.update({ where: { id: offerId }, data: { commissionValue: "900" }, select: { id: true } });
  await recount(db, userId, { today: "2026-10-11", months: ["2026-10-01"], offerId });
  assert.equal((await readTodayHeader(db, userId, "2026-10-01")).stats?.commissionEarned, "500");

  // a follow-up call after the close counts in «llamadas desde el último cierre»
  const callB = await pendingCall(userId, "2026-10-07T16:00:00Z", { cliente_real: "Pedro Ruiz", estado_lead: "decidiendo" });
  await confirmCall(db, userId, { callId: callB, version: await version(callB), outcome: "SEGUIMIENTO" }, { revalidate, now: NOW });
  assert.equal((await readTodayHeader(db, userId, "2026-10-01")).counters?.callsSinceLastClose, 1);

  // a second close «no sé todavía»: no amount, PER_CLOSE commission still counts (now 900, frozen at creation)
  const callC = await pendingCall(userId, "2026-10-09T16:00:00Z", { cliente_real: "Marta Díaz", estado_lead: "cerrado", venta_total: null, citas: [] });
  const before = await snapshot(userId);
  const c = await confirmCall(db, userId, { callId: callC, version: await version(callC), outcome: "CERRO", deal: { amountTotal: "", cashCollected: "", paymentMode: null } }, { revalidate, now: NOW });
  assert.ok(c.ok && c.changeId);
  const dealC = await db.deal.findFirstOrThrow({ where: { userId, callId: callC }, select: { amountTotal: true, commissionAmount: true, paymentMode: true } });
  assert.deepEqual([dealC.amountTotal, dealC.commissionAmount?.toString(), dealC.paymentMode], [null, "900", null]);
  let h = await readTodayHeader(db, userId, "2026-10-01");
  assert.deepEqual([h.counters?.lastCloseLeadName, h.counters?.callsSinceLastClose, h.stats?.commissionEarned, h.stats?.closedCount], ["Marta Díaz", 0, "1400", 2]);

  // undo C: the deal is annulled, «último cierre» goes back to Laura (last ACTIVE deal), numbers exactly as before
  await undoProposedChange(db, userId, c.changeId!, { revalidate, now: NOW });
  h = await readTodayHeader(db, userId, "2026-10-01");
  assert.deepEqual([h.counters?.lastCloseLeadName, h.counters?.callsSinceLastClose, h.stats?.commissionEarned], ["Laura Gómez", 1, "500"]);
  // Marta was created by that tap, so she goes away with it (and her sale with her); no ACTIVO sale is left
  assert.equal(await db.deal.findFirst({ where: { userId, callId: callC, status: "ACTIVO" }, select: { id: true } }), null);
  assert.deepEqual(await snapshot(userId), before);
});

test("PCT_SALE: the commission is a share of the amount; without the amount it stays «por confirmar» (null)", { skip }, async () => {
  const userId = await newUser("pct");
  await offer(userId, "Mentoría 90 días", { commissionType: "PCT_SALE", commissionValue: "10" });
  const a = await pendingCall(userId, "2026-10-02T16:00:00Z", { cliente_real: "Ana", estado_lead: "cerrado" });
  const b = await pendingCall(userId, "2026-10-03T16:00:00Z", { cliente_real: "Bea", estado_lead: "cerrado" });
  await confirmCall(db, userId, { callId: a, version: await version(a), outcome: "CERRO", deal: { amountTotal: "1500" } }, { revalidate, now: NOW });
  await confirmCall(db, userId, { callId: b, version: await version(b), outcome: "CERRO", deal: { amountTotal: "" } }, { revalidate, now: NOW });
  const deals = await db.deal.findMany({ where: { userId }, orderBy: { closedAt: "asc" }, take: 5, select: { commissionAmount: true } });
  assert.deepEqual(deals.map((d) => d.commissionAmount?.toString() ?? null), ["150", null]);
  assert.equal((await readTodayHeader(db, userId, "2026-10-01")).stats?.commissionEarned, "150");
  const bad = await confirmCall(db, userId, { callId: a, version: "1", outcome: "CERRO", deal: { amountTotal: "mucho" } }, { revalidate, now: NOW });
  assert.deepEqual(bad, { ok: true, changeId: null, leadId: (await db.call.findUniqueOrThrow({ where: { id: a }, select: { leadId: true } })).leadId, already: true });
});

test("«¿Quién es?»: two people with the same name → never created blindly; picking one updates that person", { skip }, async () => {
  const userId = await newUser("who");
  const other = await newUser("who-other");
  const foreign = await lead(other, "Laura Gómez");
  const l1 = await lead(userId, "Laura Gómez");
  const l2 = await lead(userId, "Laura  Gomez");
  const callId = await pendingCall(userId, "2026-10-06T16:00:00Z");
  const [card] = await readPending(db, userId);
  assert.equal(card.who.kind, "pick");
  assert.deepEqual(card.who.kind === "pick" ? card.who.candidates.map((c) => c.id).sort() : [], [l1, l2].sort());
  const v = await version(callId);
  const blind = await confirmCall(db, userId, { callId, version: v, outcome: "SEGUIMIENTO" }, { revalidate, now: NOW });
  assert.deepEqual(blind, { ok: false, error: "Elige quién es antes de guardar." });
  const stolen = await confirmCall(db, userId, { callId, version: v, outcome: "SEGUIMIENTO", who: `lead:${foreign}` }, { revalidate, now: NOW });
  assert.deepEqual(stolen, { ok: false, error: "No encontré a esa persona." });
  assert.equal((await db.proposedChange.findMany({ where: { userId, kind: "CONFIRM_CALL" }, take: 5, select: { id: true } })).length, 0);
  const ok = await confirmCall(db, userId, { callId, version: v, outcome: "SEGUIMIENTO", who: `lead:${l2}` }, { revalidate, now: NOW });
  assert.ok(ok.ok);
  assert.equal(ok.leadId, l2);
  const people = await db.lead.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 5, select: { id: true, lastCallId: true } });
  assert.equal(people.length, 2);
  assert.equal(people.find((p) => p.id === l2)?.lastCallId, callId);
  assert.equal(people.find((p) => p.id === l1)?.lastCallId, null);
  assert.equal((await db.call.findUniqueOrThrow({ where: { id: callId }, select: { leadId: true } })).leadId, l2);
  // an older call confirmed later never overwrites the person's latest status
  const older = await pendingCall(userId, "2026-09-20T16:00:00Z", { estado_lead: "perdido" });
  await confirmCall(db, userId, { callId: older, version: await version(older), outcome: "PERDIDO", who: `lead:${l2}` }, { revalidate, now: NOW });
  assert.deepEqual(await db.lead.findUniqueOrThrow({ where: { id: l2 }, select: { status: true, lastCallId: true } }), { status: "SEGUIMIENTO", lastCallId: callId });
});

test("«Ignoradas (N)»: an internal call does not vanish; «No era interna» brings it back with suggestions from the stored brief (no model call)", { skip }, async () => {
  const userId = await newUser("ign");
  const callId = await pendingCall(userId, "2026-10-04T16:00:00Z", { estado_agenda: "INTERNA" }, [{ name: "Laura Gómez", email: "laura@example.test" }]);
  let counters = (await snapshot(userId)).counters;
  assert.deepEqual([counters.ignoredCount, counters.pendingConfirmCount], [1, 0]);
  assert.deepEqual((await readIgnored(db, userId)).map((c) => c.id), [callId]);
  assert.equal((await db.proposedChange.findMany({ where: { userId }, take: 5, select: { id: true } })).length, 0);

  tagsSeen.length = 0;
  const r = await recoverIgnoredCall(db, userId, callId, { revalidate, now: NOW });
  assert.deepEqual(r, { ok: true });
  assert.ok(tagsSeen.includes(`u:${userId}:pending`));
  counters = (await snapshot(userId)).counters;
  assert.deepEqual([counters.ignoredCount, counters.pendingConfirmCount], [0, 1]);
  const [card] = await readPending(db, userId);
  // built from the stored brief: the name comes from it; no suggestion → no black border
  assert.deepEqual([card.id, card.who, card.suggestedOutcome], [callId, { kind: "new", name: "Laura Gómez" }, null]);
  assert.deepEqual((await db.callObjection.findMany({ where: { userId }, take: 5, select: { label: true } })).map((o) => o.label), ["Lo tiene que consultar"]);
  assert.deepEqual(await recoverIgnoredCall(db, userId, callId, { revalidate, now: NOW }), { ok: false, error: "Esa llamada ya no está entre las ignoradas." });
  const done = await confirmCall(db, userId, { callId, version: await version(callId), outcome: "SEGUIMIENTO" }, { revalidate, now: NOW });
  assert.ok(done.ok);
});
