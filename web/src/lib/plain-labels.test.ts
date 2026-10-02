import assert from "node:assert/strict";
import { test } from "node:test";
import { plainStatus } from "./plain-labels";

test("screen labels hide internal status codes", () => {
  assert.equal(plainStatus("CIERRE VENTA"), "Cerró");
  assert.equal(plainStatus("DECISION"), "Decisión");
  assert.equal(plainStatus("PENDIENTE"), "Por cobrar");
  assert.equal(plainStatus("SEGUNDA_REUNION"), "Segunda reunión");
  assert.equal(plainStatus("SEGUIMIENTO"), "Seguimiento");
  assert.equal(plainStatus("POST_COBRANZA"), "Después del cobro");
  assert.equal(plainStatus("ALGO_NUEVO"), "Algo Nuevo");
  assert.equal(plainStatus(""), "—");
});
