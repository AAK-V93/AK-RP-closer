// PR 4 (Metas): pure tests for the path, the week and month against month.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chosenPathIndex,
  goalPath,
  goalProgress,
  meetingPace,
  monthCompare,
  pathKey,
  pathMissingLabel,
  pathOffer,
  readChosenPath,
  toChosenPath,
  weekProgress,
  weekRemaining,
  weeklyMeetingsSuggestion,
  weeksLeftInMonth,
} from "@/lib/metrics";

const circulo = { id: "c", name: "Círculo Millonario", currency: "USD", commissionType: "PER_CLOSE" as const, commissionValue: "900" };
const fertilidad = {
  id: "f",
  name: "Fertilidad Consciente",
  currency: "USD",
  commissionType: "PCT_CASH" as const,
  commissionValue: "20",
  priceCash: "1500",
};

test("camino of the mockup: 1.760 left → 2 Círculo, 1 Círculo + 3 Fertilidad, 6 Fertilidad", () => {
  const offers = [pathOffer(fertilidad, "USD"), pathOffer(circulo, "USD")];
  const { paths, missing } = goalPath(176_000, offers, 6);
  assert.deepEqual(missing, []);
  assert.deepEqual(
    paths.map((p) => [p.closes.map((c) => `${c.count} ${c.offerId}`).join(" + "), p.commissionCents, p.meetings]),
    [
      ["2 c", 180_000, 12],
      ["1 c + 3 f", 180_000, 24],
      ["6 f", 180_000, 36],
    ],
  );
});

test("PR 4 done-when: no calls → closes with «reuniones por confirmar»; ≥3 decided → ≈ N", () => {
  const offers = [pathOffer(circulo, "USD")];
  const noCalls = meetingPace({ callsHeld: 0, closedCount: 0, lostCount: 0 }, null);
  assert.equal(noCalls, null);
  assert.deepEqual(goalPath(300_000, offers, noCalls).paths[0], {
    closes: [{ offerId: "c", offerName: "Círculo Millonario", count: 4 }],
    commissionCents: 360_000,
    meetings: null,
  });
  // 2 decided is not enough
  assert.equal(meetingPace({ callsHeld: 6, closedCount: 1, lostCount: 1 }, null), null);
  // 18 calls, 3 closed, 5 lost → 1 in 6
  const pace = meetingPace({ callsHeld: 18, closedCount: 3, lostCount: 5 }, null);
  assert.equal(pace, 6);
  assert.equal(goalPath(300_000, offers, pace).paths[0].meetings, 24);
});

test("rounding: closes round up, a goal already met has no path", () => {
  assert.equal(goalPath(90_001, [pathOffer(circulo, "USD")], null).paths[0].closes[0].count, 2);
  assert.equal(goalPath(90_000, [pathOffer(circulo, "USD")], null).paths[0].closes[0].count, 1);
  const met = goalProgress(300_000, 310_000, new Date("2026-10-11T15:00:00Z"));
  assert.equal(met.done, true);
  assert.equal(met.remaining, 0);
  assert.equal(met.ratio, 1);
  assert.deepEqual(goalPath(met.remaining, [pathOffer(circulo, "USD")], 6).paths, []);
});

test("offers that cannot be valued: no commission, PCT without cash price, another currency", () => {
  const noCommission = { id: "n", name: "Sin comisión", currency: "USD", commissionType: null, commissionValue: null };
  const pctNoCash = { ...fertilidad, priceCash: null };
  const eur = { ...circulo, id: "e", name: "Mentoría Europa", currency: "EUR" };
  const offers = [noCommission, pctNoCash, eur, circulo].map((o) => pathOffer(o, "USD"));
  const { paths, missing } = goalPath(100_000, offers, null);
  assert.deepEqual(paths.map(pathKey), ["c"]);
  const byId = Object.fromEntries(missing.map((m) => [m.offerId, m.reason]));
  assert.deepEqual(byId, { n: "COMMISSION", f: "PRICE", e: "CURRENCY" });
  assert.equal(pathMissingLabel("PRICE", "Fertilidad Consciente", "USD", "USD"), "Falta el precio de contado de Fertilidad Consciente");
  assert.equal(pathMissingLabel("COMMISSION", "Sin comisión", "USD", "USD"), "Falta tu comisión en Sin comisión");
  assert.equal(
    pathMissingLabel("CURRENCY", "Mentoría Europa", "EUR", "USD"),
    "Mentoría Europa está en EUR y tu meta en USD: no la sumo al camino",
  );
});

test("the chosen path survives recalculation by its offers, not its counts", () => {
  const offers = [pathOffer(circulo, "USD"), pathOffer(fertilidad, "USD")];
  const before = goalPath(176_000, offers, 6).paths;
  const chosen = readChosenPath(JSON.parse(JSON.stringify(toChosenPath(before[1], new Date("2026-10-05T12:00:00Z")))));
  assert.deepEqual(chosen?.offerIds, ["c", "f"]);
  const after = goalPath(120_000, offers, 6).paths; // less left, the mix still exists
  assert.equal(chosenPathIndex(after, chosen), 1);
  assert.equal(chosenPathIndex(goalPath(50_000, offers, 6).paths, chosen), null); // one Círculo is enough: no mix
  assert.equal(readChosenPath({ nope: true }), null);
  assert.equal(readChosenPath(null), null);
});

test("weekly suggestion spreads the path's meetings over the weeks left; none without pace", () => {
  // October 2026: week of Oct 5 → weeks starting 5, 12, 19, 26 → 4
  assert.equal(weeksLeftInMonth("2026-10-05", "2026-10-01"), 4);
  assert.equal(weeksLeftInMonth("2026-10-26", "2026-10-01"), 1);
  // the week of Sep 28 touches October
  assert.equal(weeksLeftInMonth("2026-09-28", "2026-10-01"), 5);
  assert.equal(weeklyMeetingsSuggestion({ meetings: 12 }, "2026-10-05", "2026-10-01"), 3);
  assert.equal(weeklyMeetingsSuggestion({ meetings: 13 }, "2026-10-05", "2026-10-01"), 4);
  assert.equal(weeklyMeetingsSuggestion({ meetings: null }, "2026-10-05", "2026-10-01"), null);
  assert.equal(weeklyMeetingsSuggestion(null, "2026-10-05", "2026-10-01"), null);
  const wk = weekProgress({ meetings: 4, attempts: 9 }, { meetingsTarget: 6, followupsTarget: 12 });
  assert.equal(weekRemaining(wk.meetings.done, wk.meetings.target), 2);
  assert.equal(weekRemaining(wk.attempts.done, wk.attempts.target), 3);
  assert.equal(weekRemaining(14, 12), 0);
  assert.equal(weekRemaining(3, null), null);
});

test("monthCompare: fewer lost is better, win rate as a rate, first month without arrows", () => {
  const oct = { callsHeld: 18, closedCount: 3, lostCount: 5 };
  const sep = { callsHeld: 16, closedCount: 2, lostCount: 6 };
  const c = monthCompare(oct, sep);
  assert.equal(c.firstMonth, false);
  assert.deepEqual([c.calls.trend, c.calls.better], ["up", true]);
  assert.deepEqual([c.closed.trend, c.closed.better], ["up", true]);
  assert.deepEqual([c.lost.trend, c.lost.better], ["down", true]);
  assert.deepEqual(c.winRate.value, { won: 3, decided: 8 });
  assert.deepEqual(c.winRate.previous, { won: 2, decided: 8 });
  assert.deepEqual([c.winRate.trend, c.winRate.better], ["up", true]);
  // 1 of 3 vs 2 of 6 is the same rate
  const same = monthCompare({ callsHeld: 3, closedCount: 1, lostCount: 2 }, { callsHeld: 6, closedCount: 2, lostCount: 4 });
  assert.deepEqual([same.winRate.trend, same.winRate.better], ["same", null]);
  const first = monthCompare(oct, null);
  assert.equal(first.firstMonth, true);
  assert.equal(first.calls.trend, null);
  assert.equal(first.winRate.previous, null);
  // no row this month yet → zeros, no rate
  const empty = monthCompare(null, null);
  assert.equal(empty.calls.value, 0);
  assert.equal(empty.winRate.value, null);
});
