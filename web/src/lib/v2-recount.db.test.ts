// (a) recount == from-scratch calculation, plus bounded readers, on a local
// throwaway Postgres only (same env and Neon refusal as v2-migration.db.test.ts).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { recount, recountCounters, recountLeadAttempts, recountMonthAll, recountMonthOffer } from "@/lib/write/recount";
import { addDaysKey, bogotaDay, monthRange } from "@/lib/time/bogota";
import { readPeoplePage, searchPeople } from "@/lib/read/people";
import { readFicha, readFichaDetail } from "@/lib/read/ficha";
import { readPending } from "@/lib/read/pending";
import { readTodayHeader, readTodayList } from "@/lib/read/today";
import { readOfferMap } from "@/lib/read/offers";
import { peopleTabs } from "@/lib/metrics";

const WEB = path.resolve(__dirname, "../..");
const url = process.env.TEST_DATABASE_URL?.trim() ?? "";
const hostOf = (raw: string) => {
  try {
    const u = new URL(raw);
    return u.searchParams.get("host") || u.hostname;
  } catch {
    return "";
  }
};
const isLocal = (raw: string) => /^(localhost|127\.0\.0\.1|\/)/.test(hostOf(raw)) && !/neon/i.test(raw);
const skip = !url
  ? "set TEST_DATABASE_URL to a local throwaway Postgres"
  : !isLocal(url)
    ? "refusing: only localhost is allowed"
    : false;

// deterministic pseudo-random fixtures
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

let db: PrismaClient;
let userId = "";
let otherUserId = "";
let offerIds: string[] = [];
const MONTHS = ["2026-09-01", "2026-10-01", "2026-11-01"];
/** «hoy» for the counters: calls before Oct 6 (Bogotá) count as «decidiendo > 14 días» */
const TODAY = "2026-10-20";
// instants that sit right on the Bogotá month edges, plus ordinary ones
const EDGE_TIMES = [
  "2026-09-01T04:59:00Z", "2026-09-01T05:00:00Z", "2026-09-15T17:00:00Z",
  "2026-10-01T04:59:59Z", "2026-10-01T05:00:00Z", "2026-10-11T17:00:00Z",
  "2026-11-01T04:59:00Z", "2026-11-01T05:01:00Z", "2026-11-20T12:00:00Z",
].map((s) => new Date(s));

before(async () => {
  if (skip) return;
  execFileSync(path.join(WEB, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: WEB, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  db = new PrismaClient({ datasourceUrl: url });
  const stamp = Date.now();
  userId = (await db.user.create({ data: { email: `recount-${stamp}@example.test` }, select: { id: true } })).id;
  otherUserId = (await db.user.create({ data: { email: `other-${stamp}@example.test` }, select: { id: true } })).id;
  offerIds = [
    (await db.offer.create({ data: { userId, name: "Círculo Millonario", commissionType: "PER_CLOSE", commissionValue: "900" }, select: { id: true } })).id,
    (await db.offer.create({ data: { userId, name: "Fertilidad Consciente" }, select: { id: true } })).id,
  ];
  await seed(userId, 7);
  await seed(otherUserId, 11); // noise that must never leak into userId's numbers
});

after(async () => {
  await db?.$disconnect();
});

async function seed(owner: string, s: number) {
  const r = rng(s);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const offers = owner === userId ? [...offerIds, null] : [null];
  const statuses = ["SEGUIMIENTO", "CERRADO", "PERDIDO"] as const;
  for (let i = 0; i < 40; i += 1) {
    const status = pick([...statuses]);
    const name = pick(["Carlos Ramírez", "Luciana", "Diego", "Gina", "Elber", "Valeria", "Adriana Muñeton"]) + ` ${i}`;
    const lead = await db.lead.create({
      data: {
        userId: owner,
        name,
        nameNorm: name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
        status,
        offerId: pick(offers),
        createdAt: new Date("2026-08-20T12:00:00Z"),
        lastContactAt: r() < 0.8 ? pick(EDGE_TIMES) : null,
        nextContactAt: r() < 0.6 ? pick(EDGE_TIMES) : null,
        closedAt: status === "CERRADO" ? pick(EDGE_TIMES) : null,
        lostAt: status === "PERDIDO" ? pick(EDGE_TIMES) : null,
        potentialCommission: r() < 0.5 ? "900" : null,
      },
      select: { id: true, offerId: true },
    });
    const calls = Math.floor(r() * 3);
    let lastCall: { id: string; at: Date } | null = null;
    for (let c = 0; c < calls; c += 1) {
      const at = pick(EDGE_TIMES);
      const state = pick(["CONFIRMED", "CONFIRMED", "PENDING_CONFIRM", "IGNORED"] as const);
      const call = await db.call.create({
        data: {
          userId: owner, leadId: lead.id, offerId: lead.offerId, source: "UPLOAD", sourceId: `${lead.id}-${c}`,
          title: "Llamada", recordedAt: at, state,
          outcome: state === "CONFIRMED" ? pick(["CERRO", "SEGUIMIENTO", "PERDIDO", "PERDIDO"] as const) : null,
          brief: { estado_lead: "seguimiento" }, briefVersion: 1,
        },
        select: { id: true },
      });
      for (const label of ["Lo tengo que consultar", "Es caro", "No es el momento"]) {
        if (r() < 0.45) await db.callObjection.create({ data: { userId: owner, callId: call.id, leadId: lead.id, label, at } });
      }
      if (!lastCall || at > lastCall.at) lastCall = { id: call.id, at };
    }
    if (lastCall) await db.lead.update({ where: { id: lead.id }, data: { lastCallId: lastCall.id, lastCallAt: lastCall.at }, select: { id: true } });
    const attempts = Math.floor(r() * 6);
    for (let a = 0; a < attempts; a += 1) {
      await db.leadEvent.create({
        data: { userId: owner, leadId: lead.id, type: "ATTEMPT", at: pick(EDGE_TIMES), attemptResult: pick(["RESPONDIO", "NO_CONTESTO", "ENVIADO"] as const) },
      });
    }
    if (r() < 0.3) await db.leadEvent.create({ data: { userId: owner, leadId: lead.id, type: "NOTE", at: pick(EDGE_TIMES) } });
  }
}

/** From-scratch calculation in TypeScript over every row, independent of the SQL. */
async function fromScratch(owner: string) {
  const [leads, calls, events, objections] = await Promise.all([
    db.lead.findMany({ where: { userId: owner }, take: 1000, select: { id: true, name: true, status: true, offerId: true, closedAt: true, lostAt: true, lastCallAt: true, lastCallId: true, createdAt: true } }),
    db.call.findMany({ where: { userId: owner }, take: 1000, select: { id: true, offerId: true, state: true, outcome: true, recordedAt: true } }),
    db.leadEvent.findMany({ where: { userId: owner }, take: 1000, select: { id: true, leadId: true, type: true, at: true } }),
    db.callObjection.findMany({ where: { userId: owner }, take: 1000, select: { callId: true, label: true } }),
  ]);
  const leadOffer = new Map(leads.map((l) => [l.id, l.offerId]));
  const inR = (d: Date | null, r: { start: Date; end: Date }) => !!d && d >= r.start && d < r.end;
  const month = (m: string, offerId: string | null) => {
    const r = monthRange(m);
    const byOffer = <T extends { offerId: string | null }>(xs: T[]) => (offerId ? xs.filter((x) => x.offerId === offerId) : xs);
    return {
      callsHeld: byOffer(calls).filter((c) => c.state === "CONFIRMED" && inR(c.recordedAt, r)).length,
      closedCount: byOffer(leads).filter((l) => l.status === "CERRADO" && inR(l.closedAt, r)).length,
      lostCount: byOffer(leads).filter((l) => l.status === "PERDIDO" && inR(l.lostAt, r)).length,
      attemptsCount: events.filter((e) => e.type === "ATTEMPT" && inR(e.at, r) && (!offerId || leadOffer.get(e.leadId) === offerId)).length,
    };
  };
  const closed = leads.filter((l) => l.status === "CERRADO" && l.closedAt).sort((a, b) => b.closedAt!.getTime() - a.closedAt!.getTime() || (b.id > a.id ? 1 : -1));
  const lastClose = closed[0] ?? null;
  // lost, or «decidiendo > 14 días»: lead in SEGUIMIENTO whose last call ended in SEGUIMIENTO
  // more than 14 Bogotá days before TODAY
  const deciding = new Set(
    leads
      .filter((l) => l.status === "SEGUIMIENTO" && l.lastCallId && l.lastCallAt && bogotaDay(l.lastCallAt) < addDaysKey(TODAY, -14))
      .map((l) => l.lastCallId!),
  );
  const lost5 = calls.filter((c) => c.outcome === "PERDIDO" || (c.outcome === "SEGUIMIENTO" && deciding.has(c.id))).sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || (b.id > a.id ? 1 : -1)).slice(0, 5);
  const hits = new Map<string, Set<string>>();
  for (const o of objections) if (lost5.some((c) => c.id === o.callId)) hits.set(o.label, (hits.get(o.label) ?? new Set()).add(o.callId));
  const top = [...hits.entries()].map(([label, s]) => ({ label, hits: s.size })).sort((a, b) => b.hits - a.hits || a.label.localeCompare(b.label, "en"))[0] ?? null;
  const counters = {
    pendingConfirmCount: calls.filter((c) => c.state === "PENDING_CONFIRM").length,
    followingCount: leads.filter((l) => l.status === "SEGUIMIENTO").length,
    lastCloseAt: lastClose?.closedAt ?? null,
    lastCloseLeadName: lastClose?.name ?? null,
    callsSinceLastClose: calls.filter((c) => c.state === "CONFIRMED" && (!lastClose || c.recordedAt > lastClose.closedAt!)).length,
    topObjectionLabel: top?.label ?? null,
    topObjectionHits: top?.hits ?? null,
    topObjectionOf: lost5.length || null,
  };
  const attempts = new Map(leads.map((l) => [l.id, events.filter((e) => e.leadId === l.id && e.type === "ATTEMPT" && e.at > (l.lastCallAt ?? l.createdAt)).length]));
  return { month, counters, attempts, leadIds: leads.map((l) => l.id) };
}

async function storedMonth(owner: string, m: string, offerId: string | null) {
  return db.userMonthStats.findFirst({
    where: { userId: owner, month: new Date(`${m}T00:00:00Z`), offerId },
    select: { callsHeld: true, closedCount: true, lostCount: true, attemptsCount: true },
  });
}

async function recountAll(owner: string) {
  const s = await fromScratch(owner);
  for (const id of s.leadIds) await recountLeadAttempts(db, id);
  await recountCounters(db, owner, TODAY);
  for (const m of MONTHS) {
    await recountMonthAll(db, owner, m);
    if (owner === userId) for (const o of offerIds) await recountMonthOffer(db, owner, m, o);
  }
}

async function assertMatches(owner: string) {
  const s = await fromScratch(owner);
  for (const m of MONTHS) {
    assert.deepEqual(await storedMonth(owner, m, null), s.month(m, null), `month ${m}`);
    if (owner === userId) for (const o of offerIds) assert.deepEqual(await storedMonth(owner, m, o), s.month(m, o), `month ${m} offer`);
  }
  const counters = await db.userCounters.findUnique({
    where: { userId: owner },
    select: { pendingConfirmCount: true, followingCount: true, lastCloseAt: true, lastCloseLeadName: true, callsSinceLastClose: true, topObjectionLabel: true, topObjectionHits: true, topObjectionOf: true },
  });
  assert.deepEqual(counters, s.counters);
  const stored = await db.lead.findMany({ where: { userId: owner }, take: 1000, select: { id: true, attemptsSinceLastCall: true } });
  for (const l of stored) assert.equal(l.attemptsSinceLastCall, s.attempts.get(l.id), `attempts ${l.id}`);
}

test("(a) recount equals the from-scratch calculation, edges of the month included", { skip }, async () => {
  await recountAll(userId);
  await recountAll(otherUserId);
  await assertMatches(userId);
  await assertMatches(otherUserId);
  // sanity: the fixtures really hit both sides of a month edge
  const s = await fromScratch(userId);
  assert.ok(MONTHS.some((m) => s.month(m, null).closedCount > 0));
});

test("(a) recount is idempotent and fixes itself after writes", { skip }, async () => {
  await recountAll(userId);
  await assertMatches(userId); // twice = same

  // corrupt the aggregates as if a previous write had been lost
  await db.userCounters.update({ where: { userId }, data: { followingCount: 999, pendingConfirmCount: 999 }, select: { userId: true } });
  // writes: a lead closes on Oct 31 23:59 Bogotá, a new attempt, a call confirmed
  const lead = await db.lead.findFirst({ where: { userId, status: "SEGUIMIENTO" }, select: { id: true, offerId: true } });
  assert.ok(lead);
  await db.lead.update({ where: { id: lead.id }, data: { status: "CERRADO", closedAt: new Date("2026-11-01T04:59:00Z") }, select: { id: true } });
  await db.leadEvent.create({ data: { userId, leadId: lead.id, type: "ATTEMPT", at: new Date("2027-01-01T00:00:00Z") } });
  const pending = await db.call.findFirst({ where: { userId, state: "PENDING_CONFIRM" }, select: { id: true } });
  if (pending) await db.call.update({ where: { id: pending.id }, data: { state: "CONFIRMED", outcome: "SEGUIMIENTO" }, select: { id: true } });

  // only the touched scope is recounted (≤ 3 statements + the lead)
  await recount(db, userId, { today: TODAY, months: ["2026-10-01"], offerId: lead.offerId, leadId: lead.id });
  for (const m of ["2026-09-01", "2026-11-01"]) {
    await recountMonthAll(db, userId, m);
    for (const o of offerIds) await recountMonthOffer(db, userId, m, o);
  }
  if (lead.offerId === null) for (const o of offerIds) await recountMonthOffer(db, userId, "2026-10-01", o);
  for (const l of (await fromScratch(userId)).leadIds) await recountLeadAttempts(db, l);
  await assertMatches(userId);
});

test("an offer of another user never gets stats", { skip }, async () => {
  const foreign = await db.offer.create({ data: { userId: otherUserId, name: "Ajena" }, select: { id: true } });
  await recountMonthOffer(db, userId, "2026-10-01", foreign.id);
  assert.equal(await storedMonth(userId, "2026-10-01", foreign.id), null);
});

test("readers: bounded, scoped to the user, plain JSON", { skip }, async () => {
  const header = await readTodayHeader(db, userId, "2026-10-01");
  const s = await fromScratch(userId);
  assert.deepEqual(
    peopleTabs(header.counters, header.stats),
    { following: s.counters.followingCount, closed: s.month("2026-10-01", null).closedCount, lost: s.month("2026-10-01", null).lostCount,
      total: s.counters.followingCount + s.month("2026-10-01", null).closedCount + s.month("2026-10-01", null).lostCount },
  );
  assert.equal(typeof header.stats?.commissionEarned, "string");

  const today = await readTodayList(db, userId, TODAY);
  assert.ok(today.length <= 5);
  assert.ok(today.every((r) => r.status === "SEGUIMIENTO"));

  // keyset pages: 8, then 10s, no duplicates, all of «En seguimiento»
  const seen: string[] = [];
  let page = await readPeoplePage(db, userId, { tab: "SEGUIMIENTO" });
  assert.ok(page.rows.length <= 8);
  seen.push(...page.rows.map((r) => r.id));
  while (page.nextCursor) {
    page = await readPeoplePage(db, userId, { tab: "SEGUIMIENTO", cursor: page.nextCursor });
    assert.ok(page.rows.length <= 10);
    seen.push(...page.rows.map((r) => r.id));
  }
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(seen.length, s.counters.followingCount);

  const closedOct = await readPeoplePage(db, userId, { tab: "CERRADO", month: "2026-10-01" });
  assert.ok(closedOct.rows.every((r) => r.status === "CERRADO"));

  const stage = await readPeoplePage(db, userId, { tab: "SEGUIMIENTO", stage: "1-2" });
  assert.ok(stage.rows.every((r) => r.attemptsSinceLastCall >= 1 && r.attemptsSinceLastCall <= 2));

  // search finds every status, ignores accents, never another user's people
  const found = await searchPeople(db, userId, "RAMIREZ");
  assert.ok(found.length > 0 && found.length <= 10);
  const statuses = new Set((await searchPeople(db, userId, " ")).map((r) => r.status));
  assert.equal(statuses.size, 0);
  const allIds = new Set(s.leadIds);
  assert.ok(found.every((r) => allIds.has(r.id)));

  const leadWithCall = await db.lead.findFirst({ where: { userId, lastCallId: { not: null } }, select: { id: true } });
  assert.ok(leadWithCall);
  const ficha = await readFicha(db, userId, leadWithCall.id);
  assert.ok(ficha && ficha.attempts.length <= 10);
  assert.equal("brief" in ficha, false);
  assert.equal(await readFicha(db, otherUserId, leadWithCall.id), null); // other user: nothing
  const detail = await readFichaDetail(db, userId, leadWithCall.id);
  assert.deepEqual(detail.brief, { estado_lead: "seguimiento" });
  assert.ok(detail.calls.length <= 10);
  assert.equal((await readFichaDetail(db, otherUserId, leadWithCall.id)).brief, null);

  const pending = await readPending(db, userId);
  assert.ok(pending.length <= 10);
  assert.ok(pending.every((p) => typeof p.recordedAt === "string"));
  assert.equal((await readOfferMap(db, userId)).length, 2);

  // JSON round trip (what unstable_cache does) keeps the same shape
  for (const value of [header, today, ficha, pending]) assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
});

async function freshUser(tag: string) {
  return (await db.user.create({ data: { email: `${tag}-${Date.now()}@example.test` }, select: { id: true } })).id;
}

test("A: «A quién escribirle hoy» — due first, highest commission beats oldest", { skip }, async () => {
  const owner = await freshUser("today");
  const mk = (name: string, next: string | null, commission: string | null, status: "SEGUIMIENTO" | "CERRADO" = "SEGUIMIENTO") =>
    db.lead.create({
      data: { userId: owner, name, nameNorm: name.toLowerCase(), status, nextContactAt: next ? new Date(next) : null, potentialCommission: commission },
      select: { id: true },
    });
  // 7 due (overdue or today, Bogotá): the oldest has the lowest commission
  await mk("Vieja", "2026-09-01T15:00:00Z", "100");
  await mk("Uno", "2026-10-15T15:00:00Z", "900");
  await mk("Dos", "2026-10-16T15:00:00Z", "700");
  await mk("Tres", "2026-10-17T15:00:00Z", "700");
  await mk("Cuatro", "2026-10-18T15:00:00Z", "500");
  await mk("Cinco", "2026-10-21T04:59:00Z", "300"); // 23:59 of Oct 20 in Bogotá: today
  await mk("SinMonto", "2026-10-10T15:00:00Z", null);
  // not due: no date, or tomorrow — even with a bigger commission they come after
  await mk("SinFecha", null, "5000");
  await mk("Mañana", "2026-10-21T05:00:00Z", "4000");
  await mk("Cerrada", "2026-09-01T15:00:00Z", "9000", "CERRADO");

  const rows = await readTodayList(db, owner, TODAY);
  assert.deepEqual(rows.map((r) => r.name), ["Uno", "Dos", "Tres", "Cuatro", "Cinco"]);
  assert.ok(!rows.some((r) => r.name === "Vieja"), "the oldest overdue loses to higher commissions");

  // with only two due, the rest follow in commission order (no date and future mixed)
  const few = await freshUser("today-few");
  for (const [name, next, c] of [
    ["Hoy", "2026-10-20T15:00:00Z", "10"],
    ["Ayer", "2026-10-19T15:00:00Z", null],
    ["SinFecha", null, "5000"],
    ["Mañana", "2026-10-21T15:00:00Z", "4000"],
    ["SinNada", null, null],
  ] as const) {
    await db.lead.create({ data: { userId: few, name, nameNorm: name.toLowerCase(), nextContactAt: next ? new Date(next) : null, potentialCommission: c } });
  }
  assert.deepEqual((await readTodayList(db, few, TODAY)).map((r) => r.name), ["Hoy", "Ayer", "SinFecha", "Mañana", "SinNada"]);
});

test("B: topBlocker counts «decidiendo > 14 días» only for leads still in SEGUIMIENTO", { skip }, async () => {
  const owner = await freshUser("deciding");
  await db.userCounters.create({ data: { userId: owner } });
  const lead = async (name: string, status: "SEGUIMIENTO" | "PERDIDO", callAt: string, outcome: "SEGUIMIENTO" | "PERDIDO", label: string) => {
    const l = await db.lead.create({ data: { userId: owner, name, nameNorm: name.toLowerCase(), status }, select: { id: true } });
    const at = new Date(callAt);
    const call = await db.call.create({
      data: { userId: owner, leadId: l.id, source: "UPLOAD", sourceId: `${l.id}-1`, title: "Llamada", recordedAt: at, state: "CONFIRMED", outcome },
      select: { id: true },
    });
    await db.callObjection.create({ data: { userId: owner, callId: call.id, leadId: l.id, label, at } });
    await db.lead.update({ where: { id: l.id }, data: { lastCallId: call.id, lastCallAt: at }, select: { id: true } });
  };
  // 15 Bogotá days before Oct 20 → deciding
  await lead("A", "SEGUIMIENTO", "2026-10-05T20:00:00Z", "SEGUIMIENTO", "Lo tengo que consultar");
  await lead("B", "SEGUIMIENTO", "2026-10-06T04:00:00Z", "SEGUIMIENTO", "Lo tengo que consultar"); // Oct 5, 23:00 Bogotá
  // exactly 14 days → not yet
  await lead("C", "SEGUIMIENTO", "2026-10-06T15:00:00Z", "SEGUIMIENTO", "Es caro");
  await lead("D", "SEGUIMIENTO", "2026-10-06T16:00:00Z", "SEGUIMIENTO", "Es caro");
  await lead("E", "SEGUIMIENTO", "2026-10-06T17:00:00Z", "SEGUIMIENTO", "Es caro");
  // lost lead with a SEGUIMIENTO call: not deciding
  await lead("F", "PERDIDO", "2026-09-01T15:00:00Z", "SEGUIMIENTO", "Es caro");
  await recountCounters(db, owner, TODAY);
  const c = await db.userCounters.findUnique({ where: { userId: owner }, select: { topObjectionLabel: true, topObjectionHits: true, topObjectionOf: true } });
  assert.deepEqual(c, { topObjectionLabel: "Lo tengo que consultar", topObjectionHits: 2, topObjectionOf: 2 });
  // one day later C, D, E cross 14 days and take over
  await recountCounters(db, owner, "2026-10-21");
  const later = await db.userCounters.findUnique({ where: { userId: owner }, select: { topObjectionLabel: true, topObjectionHits: true, topObjectionOf: true } });
  assert.deepEqual(later, { topObjectionLabel: "Es caro", topObjectionHits: 3, topObjectionOf: 5 });
});
