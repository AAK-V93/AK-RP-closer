import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildExtractorPattern,
  gapWeekCounts,
  matchesLearnedNonCommercial,
} from "./extractor-feedback";
import { analyzeCardStatus, coachCardStatus, followupCardStatus } from "./home-desk";
import { quickFollowupIso } from "./followup-date";

test("ten Impromptu corrections become a non-commercial rule", () => {
  const rows = Array.from({ length: 10 }, () => ({
    campo: "estado_agenda",
    valorCorregido: "NO_COMERCIAL",
    title: "Impromptu Google Meet Meeting",
  }));
  const pattern = buildExtractorPattern(rows);
  assert.equal(pattern.rules[0]?.token, "impromptu");
  assert.match(pattern.summary, /no comercial/i);
  assert.equal(
    matchesLearnedNonCommercial("Impromptu Google Meet Meeting", pattern),
    true,
  );
  assert.equal(matchesLearnedNonCommercial("Cierre con Ana", pattern), false);
});

test("nine corrections do not auto-classify yet", () => {
  const rows = Array.from({ length: 9 }, () => ({
    campo: "estado_agenda",
    valorCorregido: "NO_COMERCIAL",
    title: "Impromptu Google Meet Meeting",
  }));
  const pattern = buildExtractorPattern(rows);
  assert.equal(pattern.rules.length, 0);
  assert.equal(matchesLearnedNonCommercial("Impromptu", pattern), false);
});

test("home cards keep a status line even when nothing is pending", () => {
  assert.equal(analyzeCardStatus(5), "5 sin clasificar");
  assert.equal(analyzeCardStatus(0), "Todo al día");
  assert.equal(followupCardStatus(4, 1), "4 hoy · 1 vencido");
  assert.equal(followupCardStatus(0, 3), "0 hoy · 3 vencidos");
  assert.equal(followupCardStatus(0, 0), "Todo al día");
  assert.equal(coachCardStatus({ newPattern: true, analyzedThisWeek: 2 }), "Nuevo patrón detectado");
  assert.equal(
    coachCardStatus({ newPattern: false, analyzedThisWeek: 2 }),
    "2 llamadas analizadas esta semana",
  );
  assert.equal(coachCardStatus({ newPattern: false, analyzedThisWeek: 0 }), "Sin novedades");
});

test("gap weeks split Monday to Monday", () => {
  const now = new Date("2026-09-22T15:00:00.000Z");
  const counts = gapWeekCounts(
    [
      new Date("2026-09-22T12:00:00.000Z"),
      new Date("2026-09-21T12:00:00.000Z"),
      new Date("2026-09-16T12:00:00.000Z"),
      new Date("2026-09-15T12:00:00.000Z"),
    ],
    now,
  );
  assert.equal(counts.thisWeek, 2);
  assert.equal(counts.lastWeek, 2);
});

test("quick follow-up chips land on real days", () => {
  const thursday = new Date("2026-09-17T18:00:00.000Z");
  assert.equal(quickFollowupIso("hoy", thursday), "2026-09-17");
  assert.equal(quickFollowupIso("manana", thursday), "2026-09-18");
  assert.equal(quickFollowupIso("semana", thursday), "2026-09-18");
});
