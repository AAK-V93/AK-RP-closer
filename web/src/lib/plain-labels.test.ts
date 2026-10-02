import assert from "node:assert/strict";
import { test } from "node:test";
import { plainStatus } from "./plain-labels";

test("screen labels hide internal status codes", () => {
  assert.equal(plainStatus("CIERRE VENTA"), "Cerró");
  assert.equal(plainStatus("DECISION"), "Decisión");
  assert.equal(plainStatus("RETOMAR"), "Retomar");
  assert.equal(plainStatus("PAGO PENDIENTE"), "Pago pendiente");
  assert.equal(plainStatus("SEGUNDA REUNION"), "Segunda reunión");
  assert.equal(plainStatus("SÍ"), "Sí");
  assert.equal(plainStatus("PENDIENTE"), "Por cobrar");
  assert.equal(plainStatus("SEGUNDA_REUNION"), "Segunda reunión");
  assert.equal(plainStatus("SEGUIMIENTO"), "Seguimiento");
  assert.equal(plainStatus("POST_COBRANZA"), "Después del cobro");
  assert.equal(plainStatus("ALGO_NUEVO"), "Algo Nuevo");
  assert.equal(plainStatus(""), "—");
  assert.equal(plainStatus("SHOW"), "Asistió");
  assert.equal(plainStatus("NO SHOW"), "No asistió");
  assert.equal(plainStatus("PAGO PENDIENTE"), "Pago pendiente");
  assert.equal(plainStatus("RETOMAR"), "Retomar");
  assert.equal(plainStatus("MEET"), "Meet");
  assert.equal(plainStatus("ZOOM"), "Zoom");
  assert.equal(plainStatus("OTROS"), "Otros");
  assert.equal(plainStatus("SI"), "Sí");
});
