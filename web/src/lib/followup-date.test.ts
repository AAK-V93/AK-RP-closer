import assert from "node:assert/strict";
import { test } from "node:test";
import { inferCallDate, inferFollowupDate } from "./followup-date";

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

test("keeps the clock on a weekday and a short month", () => {
  const call = new Date("2026-09-29T15:00:00.000Z");
  assert.equal(
    inferFollowupDate("llamada del 29/09/2026. seguimiento lunes 5 oct 4 pm", call),
    "2026-10-05 16:00",
  );
  assert.equal(inferFollowupDate("el lunes a las 4 pm", call), "2026-10-05 16:00");
});

test("a pasted transcript dated 29/09 is not the paste day", () => {
  const now = new Date("2026-10-01T15:00:00.000Z");
  const date = inferCallDate("la llamada fue el 29/09/2026", now);
  assert.equal(date?.toISOString().slice(0, 10), "2026-09-29");
});
