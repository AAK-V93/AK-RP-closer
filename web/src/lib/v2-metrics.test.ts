import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pathMissingLabel,
  atStake,
  balance,
  cashCollected,
  closestToGoal,
  commissionEarned,
  commissionForDeal,
  commissionPerClose,
  type DealRow,
  dueToday,
  followUpProgress,
  followUpStage,
  followUpStageRange,
  goalPath,
  goalProgress,
  meetingPace,
  missingPerCloseLabel,
  perCloseCommission,
  morePeople,
  openFollowUps,
  overdue,
  peopleTabs,
  pendingToConfirm,
  salesTotal,
  sinceLastClose,
  sumInCurrency,
  toCents,
  topBlocker,
  weekProgress,
  winRate,
} from "@/lib/metrics";
import { monthRange } from "@/lib/time/bogota";

const oct = monthRange("2026-10-01");
const deal = (p: Partial<DealRow>): DealRow => ({
  status: "ACTIVO",
  closedAt: new Date("2026-10-10T15:00:00Z"),
  currency: "USD",
  amountTotal: null,
  cashCollected: null,
  commissionAmount: null,
  ...p,
});

test("money: cents, user's currency only, others «por confirmar»", () => {
  assert.equal(toCents("1597.50"), 159750);
  assert.equal(toCents(null), null);
  const s = sumInCurrency(
    [
      { amount: "100.10", currency: "USD" },
      { amount: "0.20", currency: "USD" },
      { amount: "500", currency: "COP" },
      { amount: null, currency: "USD" },
    ],
    "USD",
  );
  assert.deepEqual(s, { cents: 10030, currency: "USD", counted: 2, missing: 1, otherCurrency: 1 });
  assert.deepEqual(sumInCurrency([], "USD"), { cents: 0, currency: "USD", counted: 0, missing: 0, otherCurrency: 0 });
});

test("ventas, cobrado y comisión: period, active only, currency", () => {
  const deals = [
    deal({ amountTotal: "3000", cashCollected: "1000", commissionAmount: "900" }),
    deal({ amountTotal: null, cashCollected: null, commissionAmount: "300" }), // sin monto
    deal({ amountTotal: "5000", currency: "EUR", commissionAmount: "100" }), // otra moneda
    deal({ amountTotal: "999", status: "ANULADO" }),
    deal({ amountTotal: "777", closedAt: new Date("2026-11-01T05:00:00Z") }), // noviembre local
    deal({ amountTotal: "111", closedAt: new Date("2026-11-01T04:59:00Z") }), // aún octubre local
  ];
  const sales = salesTotal(deals, oct, "USD");
  assert.equal(sales.cents, 311100);
  assert.equal(sales.missing, 1);
  assert.equal(sales.otherCurrency, 1);
  assert.equal(cashCollected(deals, oct, "USD").cents, 100000);
  assert.equal(commissionEarned(deals, oct, "USD").cents, 120000);
  assert.equal(commissionEarned([], oct, "USD").cents, 0);
});

test("saldo: null («sin dato») if a part is missing", () => {
  assert.equal(balance({ amountTotal: "3000", cashCollected: "1000" }), 200000);
  assert.equal(balance({ amountTotal: "3000", cashCollected: null }), null);
  assert.equal(balance({ amountTotal: null, cashCollected: "10" }), null);
});

test("commission rule: PER_CLOSE at close, PCT_* need their base", () => {
  const per = { commissionType: "PER_CLOSE" as const, commissionValue: "900" };
  assert.equal(commissionForDeal(per, { amountTotal: null, cashCollected: null }), 90000);
  const sale = { commissionType: "PCT_SALE" as const, commissionValue: "3", priceCash: "1500" };
  assert.equal(commissionForDeal(sale, { amountTotal: "10000", cashCollected: null }), 30000);
  assert.equal(commissionForDeal(sale, { amountTotal: null, cashCollected: "100" }), null);
  const cash = { commissionType: "PCT_CASH" as const, commissionValue: "5" };
  assert.equal(commissionForDeal(cash, { amountTotal: "10000", cashCollected: "3000" }), 15000);
  assert.equal(commissionForDeal({ commissionType: null, commissionValue: null }, { amountTotal: "1", cashCollected: "1" }), null);
  assert.equal(commissionPerClose(per), 90000);
  assert.equal(commissionPerClose(sale), 4500);
  assert.equal(commissionPerClose({ commissionType: "PCT_CASH", commissionValue: "5", priceCash: null }), null);
});

test("seguimiento N de 10 and stages", () => {
  assert.deepEqual(followUpProgress(0), { count: 0, dots: 0, max: 10, inTarget: false });
  assert.deepEqual(followUpProgress(12), { count: 12, dots: 10, max: 10, inTarget: true });
  assert.equal(followUpProgress(6).inTarget, true);
  assert.deepEqual([0, 1, 2, 3, 5, 6, 10, 14].map(followUpStage), [
    "SIN_INTENTOS", "1-2", "1-2", "3-5", "3-5", "6-10", "6-10", "6-10",
  ]);
  assert.deepEqual(followUpStageRange("6-10"), { gte: 6 });
  assert.deepEqual(followUpStageRange("SIN_INTENTOS"), { gte: 0, lte: 0 });
});

test("tasks: today and earlier days, OPEN only", () => {
  const t = (d: string, status: "OPEN" | "DONE" = "OPEN") => ({ status, dueDate: new Date(`${d}T00:00:00Z`) });
  const tasks = [t("2026-10-11"), t("2026-10-10"), t("2026-10-12"), t("2026-10-09", "DONE")];
  assert.equal(dueToday(tasks, "2026-10-11").length, 1);
  assert.equal(overdue(tasks, "2026-10-11").length, 1);
  assert.deepEqual(dueToday([], "2026-10-11"), []);
});

test("win rate and pace: hidden or «por confirmar» without data", () => {
  assert.equal(winRate(0, 0), null);
  assert.deepEqual(winRate(1, 4), { won: 1, decided: 5 });
  assert.equal(meetingPace({ callsHeld: 5, closedCount: 1, lostCount: 1 }, null), null); // < 3 decided
  assert.equal(meetingPace({ callsHeld: 10, closedCount: 0, lostCount: 4 }, null), null); // no close
  assert.equal(meetingPace({ callsHeld: 7, closedCount: 1, lostCount: 1 }, { callsHeld: 5, closedCount: 1, lostCount: 0 }), 6);
});

const counters = {
  followingCount: 18,
  pendingConfirmCount: 5,
  callsSinceLastClose: 4,
  lastCloseAt: "2026-10-01T20:00:00.000Z",
  lastCloseLeadName: "Valeria",
  topObjectionLabel: "Lo tengo que consultar",
  topObjectionHits: 3,
  topObjectionOf: 5,
};

test("people of the month: 18 + 3 + 5 = 26, and «N personas más»", () => {
  assert.deepEqual(peopleTabs(counters, { closedCount: 3, lostCount: 5 }), { following: 18, closed: 3, lost: 5, total: 26 });
  assert.deepEqual(peopleTabs(null, null), { following: 0, closed: 0, lost: 0, total: 0 });
  assert.equal(morePeople(counters, 5), 13);
  assert.equal(morePeople(null, 5), 0);
  assert.equal(openFollowUps(counters), 18);
  assert.equal(pendingToConfirm(null), 0);
});

test("since last close and blocker", () => {
  const s = sinceLastClose(counters, new Date("2026-10-11T17:00:00Z"));
  assert.equal(s.calls, 4);
  assert.equal(s.lastClose?.daysAgo, 10);
  assert.equal(s.lastClose?.leadName, "Valeria");
  assert.deepEqual(sinceLastClose(null, new Date()), { calls: 0, lastClose: null }); // «Aún no registras cierres»
  assert.deepEqual(topBlocker(counters), { label: "Lo tengo que consultar", hits: 3, of: 5 });
  assert.equal(topBlocker({ ...counters, topObjectionOf: 2 }), null); // < 3 lost: generic, labelled
  assert.equal(topBlocker(null), null);
});

test("week progress without a goal has no target", () => {
  assert.deepEqual(weekProgress({ meetings: 4, attempts: 9 }, { meetingsTarget: 6, followupsTarget: 12 }), {
    meetings: { done: 4, target: 6 },
    attempts: { done: 9, target: 12 },
  });
  assert.equal(weekProgress({ meetings: 0, attempts: 0 }, null).meetings.target, null);
});

test("goal progress, en juego and closest to goal", () => {
  const g = goalProgress(300000, 124000, new Date("2026-10-11T17:00:00Z"));
  assert.equal(g.remaining, 176000);
  assert.equal(g.daysLeft, 21);
  assert.equal(goalProgress(300000, 350000, new Date()).remaining, 0); // ya cumplida
  assert.equal(goalProgress(300000, 350000, new Date()).done, true);
  const leads = [
    { id: "a", name: "Diego", status: "SEGUIMIENTO" as const, potentialCommission: "900", currency: "USD" },
    { id: "b", name: "Gina", status: "SEGUIMIENTO" as const, potentialCommission: "300", currency: "USD" },
    { id: "c", name: "Elber", status: "SEGUIMIENTO" as const, potentialCommission: null, currency: "USD" },
    { id: "d", name: "Ana", status: "CERRADO" as const, potentialCommission: "900", currency: "USD" },
    { id: "e", name: "Luis", status: "SEGUIMIENTO" as const, potentialCommission: "1000", currency: "EUR" },
  ];
  const stake = atStake(leads, "USD");
  assert.equal(stake.cents, 120000);
  assert.equal(stake.missing, 1);
  assert.equal(stake.otherCurrency, 1);
  assert.deepEqual(closestToGoal(leads, "USD").map((l) => l.id), ["a", "b"]);
});

test("goal path: rounding, mix, missing commission, pace", () => {
  const offers = [
    { id: "c", name: "Círculo Millonario", perCloseCents: 90000 },
    { id: "f", name: "Fertilidad Consciente", perCloseCents: 30000 },
    { id: "x", name: "Sin comisión", perCloseCents: null },
  ];
  const { paths, missing } = goalPath(176000, offers, 6);
  assert.deepEqual(missing, [{ offerId: "x", offerName: "Sin comisión", reason: "COMMISSION" }]);
  assert.equal(paths.length, 3);
  assert.deepEqual(paths[0].closes, [{ offerId: "c", offerName: "Círculo Millonario", count: 2 }]);
  assert.equal(paths[0].meetings, 12);
  assert.deepEqual(paths[1].closes.map((c) => c.count), [1, 3]); // 900 + 3×300 ≥ 1.760
  assert.equal(paths[1].meetings, 24);
  assert.deepEqual(paths[2].closes, [{ offerId: "f", offerName: "Fertilidad Consciente", count: 6 }]);
  assert.equal(goalPath(176000, offers, null).paths[0].meetings, null); // «por confirmar»
  assert.deepEqual(goalPath(0, offers, 6).paths, []); // meta cumplida
  assert.deepEqual(goalPath(100, [], 6), { paths: [], missing: [] });
});

test("PCT offer without cash price: «por confirmar», never from installments", () => {
  const offer = {
    commissionType: "PCT_SALE" as const,
    commissionValue: "10",
    priceCash: null,
    installmentsCount: 3,
    installmentAmount: "600",
  };
  assert.deepEqual(perCloseCommission(offer), { cents: null, missing: "PRICE" });
  assert.deepEqual(perCloseCommission({ ...offer, commissionType: "PCT_CASH" }), { cents: null, missing: "PRICE" });
  assert.deepEqual(perCloseCommission({ ...offer, priceCash: "1500" }), { cents: 15000, missing: null });
  assert.deepEqual(perCloseCommission({ commissionType: null, commissionValue: null }), { cents: null, missing: "COMMISSION" });
  const { paths, missing } = goalPath(100000, [{ id: "f", name: "Fertilidad Consciente", perCloseCents: null, missing: "PRICE" }], 6);
  assert.deepEqual(paths, []);
  assert.equal(pathMissingLabel(missing[0].reason, missing[0].offerName, "USD", "USD"), "Falta el precio de contado de Fertilidad Consciente");
  assert.equal(missingPerCloseLabel("PRICE", "Fertilidad Consciente"), "Falta el precio de contado de Fertilidad Consciente");
  assert.equal(missingPerCloseLabel("COMMISSION", "Círculo"), "Falta tu comisión en Círculo");
});
