// PR 4 (Metas) and PR 3 review item 3, on a local throwaway Postgres only
// (same refusal rules as the other *.db.test.ts files).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { metasView, pathKey, toChosenPath } from "@/lib/metrics";
import { readGoals, readStartSteps, weekStartOf } from "@/lib/read/goals";
import { readOfferMap } from "@/lib/read/offers";
import { bogotaDay, dateOnly, weekRange } from "@/lib/time/bogota";
import { chooseGoalPath, setGoal, setWeeklyGoal } from "@/lib/write/goals";
import { upsertOffer } from "@/lib/write/offers";

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
const skip = !url ? "set TEST_DATABASE_URL to a local throwaway Postgres" : !isLocal(url) ? "refusing: only localhost is allowed" : false;

let db: PrismaClient;
const tagsSeen: string[] = [];
const opts = (now?: Date) => ({ revalidate: (t: string) => void tagsSeen.push(t), now });
// Sunday Oct 11 2026, 10:00 Bogotá
const NOW = new Date("2026-10-11T15:00:00Z");
const TODAY = bogotaDay(NOW);

async function newUser(tag: string, currency = "USD") {
  return (await db.user.create({ data: { email: `metas-${tag}-${Date.now()}-${Math.random()}@example.test`, currency }, select: { id: true } })).id;
}

async function view(userId: string) {
  const settings = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { currency: true } });
  const [data, offers] = await Promise.all([readGoals(db, userId, TODAY, settings.currency), readOfferMap(db, userId)]);
  return { data, view: metasView(data, offers, settings.currency, NOW) };
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

test("item 3: a commission change re-prices only people in SEGUIMIENTO, recounts counters, revalidates leads + stats", { skip }, async () => {
  const userId = await newUser("item3");
  const offer = await upsertOffer(db, userId, { name: "Círculo", currency: "USD", commissionType: "PER_CLOSE", commissionValue: "500" }, opts(NOW));
  assert.ok(offer.ok);
  const mk = (name: string, status: "SEGUIMIENTO" | "CERRADO" | "PERDIDO") =>
    db.lead.create({
      data: { userId, name, nameNorm: name.toLowerCase(), offerId: offer.id, status, potentialCommission: "500", currency: "USD" },
      select: { id: true },
    });
  const [s, c, p] = [await mk("Sigue", "SEGUIMIENTO"), await mk("Cerró", "CERRADO"), await mk("Perdió", "PERDIDO")];
  // counters are stale on purpose: the write recounts them
  await db.userCounters.upsert({ where: { userId }, create: { userId, followingCount: 9 }, update: { followingCount: 9 } });
  tagsSeen.length = 0;
  await upsertOffer(db, userId, { id: offer.id, name: "Círculo", currency: "USD", commissionType: "PER_CLOSE", commissionValue: "900" }, opts(NOW));
  const pc = async (id: string) => (await db.lead.findUniqueOrThrow({ where: { id }, select: { potentialCommission: true } })).potentialCommission?.toString();
  assert.equal(await pc(s.id), "900");
  assert.equal(await pc(c.id), "500");
  assert.equal(await pc(p.id), "500");
  const counters = await db.userCounters.findUniqueOrThrow({ where: { userId }, select: { followingCount: true } });
  assert.equal(counters.followingCount, 1);
  for (const t of ["leads", "stats", "offers", "goal"]) assert.ok(tagsSeen.includes(`u:${userId}:${t}`), t);
});

test("empty first: no goal, no calls, no previous month", { skip }, async () => {
  const userId = await newUser("empty");
  const { data, view: v } = await view(userId);
  assert.equal(data.goal, null);
  assert.equal(v.goal, null);
  assert.equal(v.lastMonthEarnedCents, null);
  assert.equal(v.numbers.hasData, false);
  assert.equal(v.numbers.firstMonth, true);
  assert.deepEqual(v.near, []);
  assert.equal(v.blocker, null);
  assert.deepEqual(data.weekDone, { meetings: 0, attempts: 0 });
  assert.equal(data.weekGoal, null);
  assert.deepEqual(await readStartSteps(db, userId, "2026-10-01"), { goal: null, hasOffer: false, hasCall: false, backfill: "NONE" });
});

test("setGoal: validation, one row per month overwritten, past months kept as history", { skip }, async () => {
  const userId = await newUser("goal");
  assert.equal((await setGoal(db, userId, { amount: "" }, opts(NOW))).ok, false);
  assert.equal((await setGoal(db, userId, { amount: "0" }, opts(NOW))).ok, false);
  assert.equal((await setGoal(db, userId, { amount: "tres mil" }, opts(NOW))).ok, false);
  tagsSeen.length = 0;
  assert.deepEqual(await setGoal(db, userId, { amount: "2.000" }, opts(NOW)), { ok: true });
  assert.deepEqual(tagsSeen, [`u:${userId}:goal`]);
  await setGoal(db, userId, { amount: "3000" }, opts(NOW));
  await setGoal(db, userId, { amount: "1500" }, opts(new Date("2026-09-20T15:00:00Z")));
  const rows = await db.monthlyGoal.findMany({
    where: { userId },
    select: { month: true, targetCommission: true, currency: true },
    orderBy: { month: "asc" },
    take: 5,
  });
  assert.deepEqual(
    rows.map((r) => [r.month.toISOString().slice(0, 10), r.targetCommission.toString(), r.currency]),
    [["2026-09-01", "1500", "USD"], ["2026-10-01", "3000", "USD"]],
  );
  const steps = await readStartSteps(db, userId, "2026-10-01");
  assert.deepEqual(steps.goal, { targetCommission: "3000", currency: "USD" });
});

test("camino: closes with «por confirmar» without calls; ≈ N with ≥3 decided; PCT without cash; other currency", { skip }, async () => {
  const userId = await newUser("path");
  await setGoal(db, userId, { amount: "3000" }, opts(NOW));
  const circ = await upsertOffer(db, userId, { name: "Círculo Millonario", currency: "USD", commissionType: "PER_CLOSE", commissionValue: "900" }, opts(NOW));
  const fert = await upsertOffer(db, userId, { name: "Fertilidad Consciente", currency: "USD", commissionType: "PCT_CASH", commissionValue: "20" }, opts(NOW));
  const eur = await upsertOffer(db, userId, { name: "Mentoría Europa", currency: "EUR", commissionType: "PER_CLOSE", commissionValue: "700" }, opts(NOW));
  assert.ok(circ.ok && fert.ok && eur.ok);

  let { view: v } = await view(userId);
  assert.equal(v.pace, null);
  assert.deepEqual(v.goal!.paths.map((p) => [pathKey(p), p.closes[0].count, p.meetings]), [[circ.id, 4, null]]);
  assert.deepEqual(
    Object.fromEntries(v.goal!.missing.map((m) => [m.offerName, m.reason])),
    { "Fertilidad Consciente": "PRICE", "Mentoría Europa": "CURRENCY" },
  );
  assert.equal(v.goal!.progress.earned, 0);
  assert.equal(v.goal!.progress.remaining, 300_000);

  // 18 calls, 3 closed, 5 lost this month → 1 in 6
  await db.userMonthStats.create({ data: { userId, month: dateOnly("2026-10-01"), offerId: null, callsHeld: 18, closedCount: 3, lostCount: 5, commissionEarned: "1240" } });
  await db.userMonthStats.create({ data: { userId, month: dateOnly("2026-10-01"), offerId: circ.id, callsHeld: 12, closedCount: 2, lostCount: 3 } });
  await upsertOffer(db, userId, { id: fert.id, name: "Fertilidad Consciente", currency: "USD", priceCash: "1500", commissionType: "PCT_CASH", commissionValue: "20" }, opts(NOW));
  ({ view: v } = await view(userId));
  assert.equal(v.pace, 6);
  assert.equal(v.goal!.progress.remaining, 176_000);
  assert.deepEqual(
    v.goal!.paths.map((p) => [p.closes.map((c) => `${c.count}`).join("+"), p.meetings]),
    [["2", 12], ["1+3", 24], ["6", 36]],
  );
  assert.equal(v.numbers.hasData, true);
  assert.equal(v.numbers.firstMonth, true);
  const circRow = v.numbers.offers.find((o) => o.id === circ.id)!;
  assert.deepEqual(circRow.compare.winRate.value, { won: 2, decided: 5 });
  assert.equal(circRow.compare.calls.trend, null);

  // choose the mix; it survives a recalculation
  const mix = v.goal!.paths[1];
  assert.deepEqual(await chooseGoalPath(db, userId, toChosenPath(mix, NOW), opts(NOW)), { ok: true });
  ({ view: v } = await view(userId));
  assert.equal(v.goal!.chosenIndex, 1);
  assert.equal(v.chosen && pathKey(v.chosen), `${circ.id}+${fert.id}`);
  // suggestion: the mix's ≈ 24 meetings over the 4 weeks left (Oct 5, 12, 19, 26)
  assert.equal(v.week.suggestion.meetings, 6);

  // without a goal this month, choosing is refused
  const other = await newUser("nogoal");
  assert.equal((await chooseGoalPath(db, other, toChosenPath(mix, NOW), opts(NOW))).ok, false);
});

test("Esta semana: counts are this week's confirmed calls and attempts; targets saved only when confirmed", { skip }, async () => {
  const userId = await newUser("week");
  const week = weekStartOf(TODAY);
  assert.equal(week, "2026-10-05");
  const { start } = weekRange(week);
  const lead = await db.lead.create({ data: { userId, name: "Diego", nameNorm: "diego" }, select: { id: true } });
  const at = (h: number) => new Date(start.getTime() + h * 3600_000);
  const call = (sourceId: string, state: "CONFIRMED" | "PENDING_CONFIRM", recordedAt: Date) =>
    db.call.create({ data: { userId, source: "UPLOAD", sourceId, title: "x", recordedAt, state }, select: { id: true } });
  await call("a", "CONFIRMED", at(10));
  await call("b", "CONFIRMED", at(30));
  await call("c", "PENDING_CONFIRM", at(31)); // not confirmed
  await call("d", "CONFIRMED", new Date(start.getTime() - 3600_000)); // last week
  for (const h of [1, 2, 3]) await db.leadEvent.create({ data: { userId, leadId: lead.id, type: "ATTEMPT", at: at(h) } });
  await db.leadEvent.create({ data: { userId, leadId: lead.id, type: "ATTEMPT", at: new Date(start.getTime() - 60_000) } });

  let { data, view: v } = await view(userId);
  assert.deepEqual(data.weekDone, { meetings: 2, attempts: 3 });
  assert.equal(v.week.meetings.target, null);
  assert.equal(v.week.suggestion.meetings, null); // no goal, no chosen path
  assert.equal((await setWeeklyGoal(db, userId, { meetingsTarget: "seis", followupsTarget: "12" }, opts(NOW))).ok, false);
  assert.equal((await setWeeklyGoal(db, userId, { meetingsTarget: "-1", followupsTarget: "12" }, opts(NOW))).ok, false);
  tagsSeen.length = 0;
  assert.deepEqual(await setWeeklyGoal(db, userId, { meetingsTarget: "6", followupsTarget: "12" }, opts(NOW)), { ok: true });
  assert.deepEqual(tagsSeen, [`u:${userId}:goal`]);
  await setWeeklyGoal(db, userId, { meetingsTarget: "5", followupsTarget: "12" }, opts(NOW));
  ({ data, view: v } = await view(userId));
  assert.deepEqual(data.weekGoal, { meetingsTarget: 5, followupsTarget: 12 });
  assert.deepEqual([v.week.meetingsLeft, v.week.attemptsLeft], [3, 9]);
  // next Monday: last week's follow-ups prefill the form, meetings are not carried over
  const nextMonday = new Date("2026-10-12T15:00:00Z");
  const next = await readGoals(db, userId, bogotaDay(nextMonday), "USD");
  assert.equal(next.weekGoal, null);
  assert.deepEqual(next.lastWeekGoal, { meetingsTarget: 5, followupsTarget: 12 });
  const nv = metasView(next, [], "USD", nextMonday);
  assert.equal(nv.week.suggestion.followups, 12);
  assert.equal(nv.week.suggestion.meetings, null);
  assert.equal((await db.weeklyGoal.findMany({ where: { userId }, select: { id: true }, take: 5 })).length, 1);
});

test("Lo que más te acerca: top 3 in SEGUIMIENTO by commission at stake, user's currency only", { skip }, async () => {
  const userId = await newUser("near");
  const mk = (name: string, potentialCommission: string | null, currency = "USD", status: "SEGUIMIENTO" | "CERRADO" = "SEGUIMIENTO") =>
    db.lead.create({ data: { userId, name, nameNorm: name.toLowerCase(), potentialCommission, currency, status, attemptsSinceLastCall: 4 } });
  await mk("Ana", "300");
  await mk("Beto", "900");
  await mk("Carla", "900");
  await mk("Dani", "1500", "EUR");
  await mk("Eli", "2000", "USD", "CERRADO");
  await mk("Fede", null);
  await mk("Gabi", "100");
  const { view: v } = await view(userId);
  assert.deepEqual(v.near.map((n) => [n.name, n.potentialCents, n.followUp.count]), [["Beto", 90_000, 4], ["Carla", 90_000, 4], ["Ana", 30_000, 4]]);
});

test("Tus números: previous month gives arrows and «En septiembre ganaste»", { skip }, async () => {
  const userId = await newUser("compare");
  await db.userMonthStats.create({ data: { userId, month: dateOnly("2026-10-01"), callsHeld: 18, closedCount: 3, lostCount: 5 } });
  await db.userMonthStats.create({ data: { userId, month: dateOnly("2026-09-01"), callsHeld: 16, closedCount: 2, lostCount: 6, commissionEarned: "1200" } });
  const { view: v } = await view(userId);
  assert.equal(v.numbers.firstMonth, false);
  assert.equal(v.lastMonthEarnedCents, 120_000);
  assert.deepEqual([v.numbers.all.lost.trend, v.numbers.all.lost.better], ["down", true]);
  assert.deepEqual(v.numbers.all.winRate.previous, { won: 2, decided: 8 });
});
