import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyCommercial } from "./offer-commercial";
import {
  ASSUMED_CLOSE_RATE,
  ASSUMED_SHOW_RATE,
  computeProjection,
} from "./crm-projection";
import { parseMonthlyGoalUsd } from "./crm-prefs";

const rule = {
  notes: "8% contado",
  tiers: [
    {
      when: "contado",
      label: "Contado",
      pct: 0.08,
      daysMax: 7,
      paymentMode: "Contado",
    },
  ],
  pctBase: 0.08,
  umbralAcumuladoUsd: 0,
  pctSobreUmbral: 0,
  base: "cash_collected" as const,
  periodoAcumulacion: "mensual" as const,
};

const stats = {
  showRate: 0.9,
  closeRate: 0.5,
  ticket: 10_000,
  cashPct: 0.5,
  agendas: 40,
  shows: 36,
  cierres: 18,
};

test("projection uses assumed 60/25 rates under 20 real calls and says so", () => {
  const out = computeProjection({
    metaUsd: 4000,
    until: new Date("2026-09-30T12:00:00Z"),
    now: new Date("2026-09-16T12:00:00Z"),
    realCallCount: 8,
    comisionPendiente: 200,
    cashPendiente: 1000,
    mesCash: 0,
    stats,
    ticketFallback: 10_000,
    commissionRule: rule,
    followups: [],
  });
  assert.equal(out.usedAssumedRates, true);
  assert.equal(out.rates.showRate, ASSUMED_SHOW_RATE);
  assert.equal(out.rates.closeRate, ASSUMED_CLOSE_RATE);
  assert.match(out.assumedRatesLabel || "", /60% \/ close 25%/);
  assert.equal(out.asegurada > 200, true);
  assert.equal(out.falta, Math.max(0, 4000 - out.asegurada));
  assert.match(out.todayAction, /agendas\/día/);
});

test("projection uses real rates at 20+ calls", () => {
  const out = computeProjection({
    metaUsd: 4000,
    until: new Date("2026-09-30T12:00:00Z"),
    now: new Date("2026-09-16T12:00:00Z"),
    realCallCount: 20,
    comisionPendiente: 0,
    cashPendiente: 0,
    mesCash: 0,
    stats,
    ticketFallback: 10_000,
    commissionRule: rule,
    followups: [],
  });
  assert.equal(out.usedAssumedRates, false);
  assert.equal(out.rates.showRate, 0.9);
  assert.equal(out.rates.closeRate, 0.5);
  assert.equal(out.assumedRatesLabel, null);
});

test("today action prefers open DECISION followups", () => {
  const out = computeProjection({
    metaUsd: 8000,
    until: new Date("2026-09-30T12:00:00Z"),
    now: new Date("2026-09-16T12:00:00Z"),
    realCallCount: 4,
    comisionPendiente: 0,
    cashPendiente: 0,
    mesCash: 0,
    stats,
    ticketFallback: 10_000,
    commissionRule: rule,
    followups: [
      { tipo: "DECISION", enJuego: 10000, cliente: "Ana" },
      { tipo: "DECISION", enJuego: 8000, cliente: "Luis" },
      { tipo: "DECISION", enJuego: 2000, cliente: "Mara" },
      { tipo: "RETOMAR", enJuego: 5000, cliente: "Paz" },
    ],
  });
  assert.equal(out.todayAction, "Cierra 1 de tus 3 seguimientos de decisión");
});

test("parseMonthlyGoalUsd reads mil and grouped thousands", () => {
  assert.equal(parseMonthlyGoalUsd("8 mil"), 8000);
  assert.equal(parseMonthlyGoalUsd("quiero ganar 5.000 este mes"), 5000);
  assert.equal(parseMonthlyGoalUsd("USD 12000"), 12000);
  assert.equal(parseMonthlyGoalUsd("agendé a juan el 15"), null);
});

test("empty commercial does not invent a commission rule", () => {
  assert.equal(emptyCommercial().commission, null);
});
