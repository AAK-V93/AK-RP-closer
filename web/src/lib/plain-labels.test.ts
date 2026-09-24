import assert from "node:assert/strict";
import { test } from "node:test";
import { plainStatus } from "./plain-labels";

test("screen labels hide internal status codes", () => {
  assert.equal(plainStatus("CIERRE VENTA"), "Cerró");
  assert.equal(plainStatus("DECISION"), "Decisión");
  assert.equal(plainStatus("PENDIENTE"), "Por cobrar");
  assert.equal(plainStatus("SEGUNDA_REUNION"), "Segunda reunión");
  assert.equal(plainStatus(""), "—");
});
