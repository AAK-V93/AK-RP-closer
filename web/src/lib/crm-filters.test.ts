import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchesCrmListFilter,
  monthKey,
  monthLabel,
  weekKey,
  weekLabel,
} from "./crm-filters";

test("month and week keys use the calendar date", () => {
  assert.equal(monthKey("2026-09-10T15:00:00.000Z"), "2026-09");
  assert.equal(monthLabel("2026-09"), "sep 2026");
  assert.equal(weekKey("2026-09-10T15:00:00.000Z"), "2026-09-07");
  assert.equal(weekLabel("2026-09-07"), "7 sep – 13 sep");
});

test("filters combine name, estado, month and week", () => {
  const row = { name: "Ana Pérez", date: "2026-09-10", estado: "SHOW" };
  const open = { q: "", estado: "", month: "", week: "" };
  assert.equal(matchesCrmListFilter(row, open), true);
  assert.equal(matchesCrmListFilter(row, { ...open, q: "pérez" }), true);
  assert.equal(matchesCrmListFilter(row, { ...open, q: "luz" }), false);
  assert.equal(matchesCrmListFilter(row, { ...open, estado: "SHOW" }), true);
  assert.equal(matchesCrmListFilter(row, { ...open, estado: "NO SHOW" }), false);
  assert.equal(matchesCrmListFilter(row, { ...open, month: "2026-09", week: "2026-09-07" }), true);
  assert.equal(matchesCrmListFilter(row, { ...open, month: "2026-08" }), false);
});
