import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleCallTitle } from "./crm-noise";
import { pendingHeading, sliceCallHistory } from "./llamadas-density";

const NOW = new Date("2026-10-05T15:00:00Z");

test("a lead name beats Llamada del 28 sep", () => {
  assert.equal(
    pendingHeading({ leadName: "Milagros y Ronald", title: "Llamada del 28 sep, 11:04" }),
    "Milagros y Ronald",
  );
  assert.equal(
    visibleCallTitle({
      title: "Llamada del 28 sep, 11:04",
      leadName: "Milagros y Ronald",
      date: "2026-09-28T16:04:00.000Z",
    }),
    "Milagros y Ronald",
  );
  assert.match(
    pendingHeading({ leadName: "", title: "Llamada del 28 sep, 11:04" }),
    /Llamada del 28 sep/,
  );
});

test("history defaults to this week, capped, with the month and the rest behind", () => {
  const rows = [
    { id: "old", date: "2026-09-02T15:00:00.000Z" },
    { id: "week", date: "2026-10-05T15:00:00.000Z" },
    { id: "month", date: "2026-10-02T15:00:00.000Z" },
  ];
  const week = sliceCallHistory(rows, "semana", NOW);
  assert.deepEqual(week.visible.map((row) => row.id), ["week"]);
  assert.equal(week.fallback, false);
  const month = sliceCallHistory(rows, "mes", NOW);
  assert.deepEqual(month.visible.map((row) => row.id), ["week", "month"]);
  const many = Array.from({ length: 12 }, (_, index) => ({
    id: `d${index}`,
    date: "2026-10-05",
  }));
  const capped = sliceCallHistory(many, "semana", NOW);
  assert.equal(capped.visible.length, 10);
  assert.equal(capped.hidden, 2);
  const all = sliceCallHistory(rows, "todas", NOW);
  assert.equal(all.visible.length, 3);
});

test("an empty week shows the 10 most recent instead of a blank page", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `s${index}`,
    date: `2026-09-${String(index + 1).padStart(2, "0")}T15:00:00.000Z`,
  }));
  const week = sliceCallHistory(rows, "semana", NOW);
  assert.equal(week.fallback, true);
  assert.equal(week.visible.length, 10);
  assert.equal(week.visible[0]?.id, "s11");
});
