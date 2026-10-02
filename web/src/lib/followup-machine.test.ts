import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceThread,
  lastTouchText,
  nextActionText,
  pickThreadKind,
  type ThreadAnchors,
} from "./followup-machine";
import { listFollowupScripts, type FollowupScript } from "./followup-scripts";

const START = new Date("2026-09-22T15:00:00.000Z");
const ANCHORS: ThreadAnchors = { start: START, pagoAt: null, meetingAt: null };

test("a show without a close opens a decision thread on step 0", () => {
  assert.equal(
    pickThreadKind({
      estado_agenda: "SHOW",
      requiere_seguimiento: true,
      tipo_seguimiento: "DECISION",
      proximo_seguimiento: "2026-09-24",
      calificado: true,
      saldo_pendiente: 0,
      venta_total: null,
      cash_collected: null,
    }),
    "DECISION",
  );
});

test("a close with a follow-up date and no balance still opens a decision thread", () => {
  assert.equal(
    pickThreadKind({
      estado_agenda: "CIERRE VENTA",
      requiere_seguimiento: null,
      tipo_seguimiento: null,
      proximo_seguimiento: "2026-10-05 16:00",
      calificado: null,
      saldo_pendiente: 0,
      venta_total: 10000,
      cash_collected: 10000,
    }),
    "DECISION",
  );
});

test("an overdue step is vencido and a same-day step is pendiente de hoy", () => {
  const due = new Date("2026-09-26T15:00:00.000Z");
  const now = new Date("2026-10-01T15:00:00.000Z");
  assert.match(nextActionText("Escribir", due, now, false), /vencido/);
  assert.match(nextActionText("Escribir", now, now, false), /pendiente de hoy/);
});

test("marking done moves the decision thread to the next coded step", () => {
  const next = advanceThread({
    tipo: "DECISION",
    pasoActual: 0,
    action: "hecho",
    anchors: ANCHORS,
    now: START,
    hasSaldo: false,
  });
  assert.equal(next.pasoActual, 1);
  assert.equal(next.estado, "activo");
  assert.equal(next.dueAt?.toISOString().slice(0, 10), "2026-09-24");
  assert.equal(next.spawn, null);
});

test("a missed second meeting closes that thread and opens reschedule", () => {
  const next = advanceThread({
    tipo: "SEGUNDA_REUNION",
    pasoActual: 0,
    action: "no_mostro",
    anchors: { ...ANCHORS, meetingAt: new Date("2026-09-25T15:00:00.000Z") },
    now: START,
    hasSaldo: false,
  });
  assert.equal(next.estado, "cerrado");
  assert.equal(next.spawn, "REAGENDAR");
  assert.equal(next.dueAt, null);
});

test("a decision follow-up never offers a testimonial script", () => {
  const creative: FollowupScript = {
    key: "sone-contigo-tuve-una-premonicion",
    type: "DECISION",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "premonición",
    guion: "tuve una visión",
  };
  const picked = listFollowupScripts("DECISION", 0, [creative]);
  assert.equal(picked.some((row) => row.key.includes("premonic")), false);
  assert.equal(picked[0]?.type, "DECISION");
  assert.match(picked[0]?.guion || "", /Qué falta/);
});

test("the last touch is words, never a negative day count", () => {
  const text = lastTouchText(new Date("2026-09-16T15:00:00.000Z"), "no_contestó", START);
  assert.equal(text, "hace 6 días · no contestó");
  assert.equal(text.includes("-"), false);
});
