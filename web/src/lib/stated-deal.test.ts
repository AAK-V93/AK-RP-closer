import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyExtractor } from "./extractor";
import { fillStatedDeal } from "./stated-deal";

test("a stated split payment fills amount, mode and balance", () => {
  const parsed = emptyExtractor();
  fillStatedDeal(
    "Quedó en 10.000 USD, inicial 3.000 y 7.000 en cuotas.",
    parsed,
  );
  assert.equal(parsed.venta_total, 10000);
  assert.equal(parsed.saldo_pendiente, 7000);
  assert.match(parsed.modo_pago || "", /Inicial 3000 y 7000 en cuotas/);
  assert.equal(parsed.cash_collected, null);
});
