import assert from "node:assert/strict";
import { test } from "node:test";
import { planOrphanAlert } from "./followup-backfill";

const CREATED = new Date("2026-09-19T15:00:00.000Z");
const DUE = new Date("2026-09-24T15:00:00.000Z");

function alert(overrides: Partial<Parameters<typeof planOrphanAlert>[0]> = {}) {
  return {
    type: "DECISION",
    intentos: 0,
    resultado: "",
    question: "Hoy: seguimiento",
    resolved: false,
    createdAt: CREATED,
    dueAt: DUE,
    ...overrides,
  };
}

test("an open decision alert becomes step 0 of a decision thread", () => {
  const plan = planOrphanAlert(alert());
  assert.ok(plan);
  assert.equal(plan.tipo, "DECISION");
  assert.equal(plan.pasoActual, 0);
  assert.equal(plan.estado, "activo");
  assert.equal(plan.askLost, false);
  assert.equal(plan.touchAt.toISOString(), CREATED.toISOString());
  assert.equal(plan.startedAt.toISOString(), DUE.toISOString());
  assert.equal(plan.touchResultado, "enviado");
});

test("a second meeting keeps its date as the meeting anchor", () => {
  const plan = planOrphanAlert(alert({ type: "SEGUNDA REUNION" }));
  assert.ok(plan);
  assert.equal(plan.tipo, "SEGUNDA_REUNION");
  assert.equal(plan.pasoActual, 0);
  assert.equal(plan.meetingAt?.toISOString(), new Date(DUE.getTime() + 86_400_000).toISOString());
});

test("payment attempts walk the collection sequence", () => {
  const first = planOrphanAlert(alert({ type: "PAGO PENDIENTE", intentos: 0 }));
  const reminder = planOrphanAlert(alert({ type: "PAGO PENDIENTE", intentos: 1 }));
  const lost = planOrphanAlert(alert({ type: "PAGO PENDIENTE", intentos: 2 }));
  assert.equal(first?.pasoActual, 4);
  assert.equal(first?.askLost, false);
  assert.equal(reminder?.pasoActual, 5);
  assert.equal(lost?.pasoActual, 6);
  assert.equal(lost?.askLost, true);
  assert.equal(lost?.tipo, "COBRANZA");
});

test("a recorded payment closes the thread", () => {
  const plan = planOrphanAlert(alert({ type: "POST_COBRANZA", resolved: true, resultado: "pago" }));
  assert.equal(plan?.estado, "ganado");
  assert.equal(plan?.tipo, "COBRANZA");
});

test("agenda checks and commissions are not follow-up threads", () => {
  assert.equal(planOrphanAlert(alert({ type: "AGENDA_CHECK" })), null);
  assert.equal(planOrphanAlert(alert({ type: "COMISION" })), null);
});
