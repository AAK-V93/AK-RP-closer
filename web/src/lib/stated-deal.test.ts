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

test("a phone number is not the sale amount", () => {
  const parsed = emptyExtractor();
  parsed.venta_total = 51945678123;
  parsed.modo_pago = "inicial 3000 + 51945678123";
  fillStatedDeal(
    "Diego Huamán +51 945 678 123. Quedó en 10.000 USD fraccionado, inicial 3.000 y 7.000 en cuotas.",
    parsed,
  );
  assert.equal(parsed.venta_total, 10000);
  assert.equal(parsed.saldo_pendiente, 7000);
  assert.match(parsed.modo_pago || "", /Inicial 3000 y 7000 en cuotas/);
});

test("the year in the call date is not the sale, including a comma amount", () => {
  const parsed = emptyExtractor();
  fillStatedDeal(
    "Llamada de venta 30/09/2026. La inversión es de 10,000 USD, inicial de 3,000 y 7,000 en cuotas.",
    parsed,
  );
  assert.equal(parsed.venta_total, 10000);
  assert.equal(parsed.saldo_pendiente, 7000);
  assert.match(parsed.modo_pago || "", /Inicial 3000 y 7000 en cuotas/);

  const wrong = emptyExtractor();
  wrong.venta_total = 2026;
  fillStatedDeal(
    "Llamada de venta 30/09/2026. La inversión es de 10,000 USD, inicial de 3,000 y 7,000 en cuotas.",
    wrong,
  );
  assert.equal(wrong.venta_total, 10000);

  const onlyDate = emptyExtractor();
  onlyDate.venta_total = 2026;
  fillStatedDeal("Llamada de venta 30/09/2026. Quedó en pensarlo.", onlyDate);
  assert.equal(onlyDate.venta_total, null);
});

test("fraccionado without an inicial still fills amount, mode and balance", () => {
  const parsed = emptyExtractor();
  fillStatedDeal("Quedó en 10.000 USD fraccionado.", parsed);
  assert.equal(parsed.venta_total, 10000);
  assert.equal(parsed.modo_pago, "Fraccionado");
  assert.equal(parsed.saldo_pendiente, 10000);
  assert.equal(parsed.cash_collected, null);
});
