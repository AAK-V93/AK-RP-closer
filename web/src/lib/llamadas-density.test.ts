import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleCallTitle } from "./crm-noise";
import { pendingHeading, pendingPromptActions, sliceCallHistory } from "./llamadas-density";

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
  assert.equal(
    pendingHeading({ leadName: "", title: "Llamada del 28 sep, 11:04" }),
    "Sin nombre · 28 sep",
  );
  assert.equal(
    pendingHeading({ leadName: "", title: "Llamada del 28 sep, 11:04", date: "2026-09-28T16:04:00.000Z" }, NOW),
    "Sin nombre · 28 sep",
  );
});

test("every confirm question has a one-tap path, and a name stays text", () => {
  const follow = pendingPromptActions({
    field: "requiere_seguimiento",
    options: ["Sí, quedó seguimiento", "No quedó"],
    showToggle: false,
    leadName: "Dennis Sanchez Solorzano",
  });
  assert.deepEqual(
    follow.chips.map((chip) => chip.label),
    ["Segunda reunión", "Pago", "Decisión", "Retomar", "No quedó"],
  );
  assert.equal(follow.chips.find((chip) => chip.label === "No quedó")?.field, "requiere_seguimiento");
  assert.equal(follow.chips.find((chip) => chip.label === "Pago")?.field, "tipo_seguimiento");
  assert.equal(follow.freeText, false);

  for (const leadName of ["Leonardo y William Gonzalez", "José Mauricio Lezama"]) {
    const same = pendingPromptActions({
      field: "requiere_seguimiento",
      options: ["Sí, quedó seguimiento", "No quedó"],
      leadName,
    });
    assert.deepEqual(
      same.chips.map((chip) => chip.label),
      ["Segunda reunión", "Pago", "Decisión", "Retomar", "No quedó"],
    );
  }

  const yajaira = pendingPromptActions({
    field: "revision",
    options: [],
    showToggle: false,
    leadName: "Yajaira",
  });
  assert.deepEqual(
    yajaira.chips.map((chip) => chip.label),
    ["Segunda reunión", "Pago", "Decisión", "Retomar", "No quedó"],
  );
  assert.equal(yajaira.freeText, false);
  assert.equal(yajaira.sale, false);

  const kinds = pendingPromptActions({ field: "tipo_seguimiento", leadName: "Katherine Rodríguez" });
  assert.deepEqual(
    kinds.chips.map((chip) => chip.label),
    ["Segunda reunión", "Pago", "Decisión", "Retomar", "No quedó"],
  );
  assert.equal(kinds.chips.find((chip) => chip.label === "No quedó")?.field, "requiere_seguimiento");

  const milagros = pendingPromptActions({
    field: "tipo_seguimiento",
    options: ["Segunda reunión", "Pago", "Decisión", "Retomar"],
    leadName: "Milagros y Ronald",
  });
  assert.deepEqual(
    milagros.chips.map((chip) => chip.label),
    ["Segunda reunión", "Pago", "Decisión", "Retomar", "No quedó"],
  );
  assert.equal(milagros.chips.filter((chip) => chip.label === "No quedó").length, 1);

  const unnamedKinds = pendingPromptActions({ field: "tipo_seguimiento", leadName: "" });
  assert.deepEqual(
    unnamedKinds.chips.map((chip) => chip.label),
    ["Segunda reunión", "Pago", "Decisión", "Retomar"],
  );

  const who = pendingPromptActions({ field: "cliente_real", leadName: "", showToggle: false });
  assert.equal(who.sale, true);
  assert.equal(who.freeText, true);
  assert.equal(who.chips.length, 0);

  const unnamed = pendingPromptActions({
    field: "cliente_real",
    leadName: "Sin nombre",
    showToggle: true,
  });
  assert.equal(unnamed.sale, true);
  assert.equal(unnamed.chips.length, 0);
  assert.equal(unnamed.freeText, true);

  const sale = pendingPromptActions({ field: "", showToggle: true, leadName: "" });
  assert.equal(sale.sale, true);
  assert.equal(sale.freeText, false);

  const amount = pendingPromptActions({ field: "venta_total", leadName: "Ana", showToggle: true });
  assert.equal(amount.freeText, true);
  assert.equal(amount.sale, false);
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
