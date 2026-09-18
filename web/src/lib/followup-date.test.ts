import assert from "node:assert/strict";
import { test } from "node:test";
import { inferFollowupDate } from "./followup-date";

const CALL = new Date("2026-09-17T18:00:00.000Z"); // Thursday

test("infers ISO and relative Spanish follow-up dates", () => {
  assert.equal(inferFollowupDate("quedó para 2026-09-22", CALL), "2026-09-22");
  assert.equal(inferFollowupDate("te escribo mañana", CALL), "2026-09-18");
  assert.equal(inferFollowupDate("lo vemos el lunes", CALL), "2026-09-21");
  assert.equal(inferFollowupDate("el 20 de septiembre", CALL), "2026-09-20");
  assert.equal(inferFollowupDate("en 3 días", CALL), "2026-09-20");
});

test("returns null when there is no date", () => {
  assert.equal(inferFollowupDate("hablamos luego", CALL), null);
});
