import assert from "node:assert/strict";
import { test } from "node:test";
import { outcomeSentences, periodOutcomes } from "./outcome-counts";

const NOW = new Date("2026-10-05T01:00:00Z");

test("a cierre counts even without an amount, and a reason is a loss", () => {
  const result = periodOutcomes({
    now: NOW,
    period: "mes",
    calls: [
      { cliente: "Ana Salas", fecha: "2026-10-02", estadoAgenda: "CIERRE VENTA" },
      {
        cliente: "Marco Ruiz",
        fecha: "2026-10-01",
        estadoAgenda: "SHOW",
        razonNoCierre: "lo habla con el socio",
      },
      { cliente: "Elber", fecha: "2026-10-03", estadoAgenda: "SHOW" },
    ],
  });
  assert.equal(result.won, 1);
  assert.equal(result.lost, 1);
  assert.deepEqual(result.wonKeys, ["ana salas"]);
});

test("no classified call is sin datos, not a fake 0", () => {
  const result = periodOutcomes({
    now: NOW,
    period: "mes",
    calls: [{ cliente: "Elber", fecha: "2026-10-03" }],
  });
  assert.equal(result.won, null);
  assert.equal(result.lost, null);
  assert.deepEqual(outcomeSentences(result), { closes: "", versus: "" });
});

test("shows without a close are a real 0, and perdidos stay sin datos", () => {
  const result = periodOutcomes({
    now: NOW,
    period: "mes",
    calls: [{ cliente: "Ana", fecha: "2026-10-02", estadoAgenda: "SHOW" }],
  });
  assert.equal(result.won, 0);
  assert.equal(result.lost, null);
  assert.equal(outcomeSentences(result).closes, "0 cierres este mes");
  assert.equal(outcomeSentences(result).versus, "0 cerrados · perdidos sin datos");
});

test("a close from another month is not this month, and one person counts once", () => {
  const result = periodOutcomes({
    now: NOW,
    period: "mes",
    calls: [
      { cliente: "Lucía Vega", fecha: "2026-09-02", estadoAgenda: "CIERRE VENTA" },
      { cliente: "Lucía Vega", fecha: "2026-09-20", estadoAgenda: "CIERRE VENTA" },
      { cliente: "Ana", fecha: "2026-10-03", estadoAgenda: "SHOW" },
    ],
  });
  assert.equal(result.won, 0);
  const all = periodOutcomes({
    now: NOW,
    period: "todo",
    calls: [
      { cliente: "Lucía Vega", fecha: "2026-09-02", estadoAgenda: "CIERRE VENTA" },
      { cliente: "Lucía Vega", fecha: "2026-09-20", estadoAgenda: "CIERRE VENTA" },
    ],
  });
  assert.equal(all.won, 1);
});

test("a close beats a loss on the same person", () => {
  const result = periodOutcomes({
    now: NOW,
    period: "todo",
    calls: [
      {
        cliente: "Ana",
        fecha: "2026-10-02",
        estadoAgenda: "CIERRE VENTA",
        razonNoCierre: "precio",
        leadStatus: "perdido",
      },
    ],
  });
  assert.equal(result.won, 1);
  assert.equal(result.lost, null);
});

test("an undated loss is not a 0 for this month", () => {
  const result = periodOutcomes({
    now: NOW,
    period: "mes",
    calls: [{ cliente: "Marco", leadStatus: "perdido" }],
  });
  assert.equal(result.lost, null);
  const all = periodOutcomes({
    now: NOW,
    period: "todo",
    calls: [{ cliente: "Marco", leadStatus: "perdido" }],
  });
  assert.equal(all.lost, 1);
});
