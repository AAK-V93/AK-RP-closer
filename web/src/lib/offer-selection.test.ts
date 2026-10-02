import assert from "node:assert/strict";
import { test } from "node:test";
import { pickWorkspaceOffer } from "./offer-selection";
import { closerSpanish } from "./closer-spanish";

const fertilidad = { id: "fert", productName: "Fertilidad Consciente", updatedAt: "2026-10-02" };
const circulo = { id: "circ", productName: "Círculo Millonario", updatedAt: "2026-08-01" };

test("the selected offer drives the detail even when another offer was updated later", () => {
  const offers = [fertilidad, circulo];
  assert.equal(pickWorkspaceOffer(offers, null)?.productName, "Fertilidad Consciente");
  assert.equal(pickWorkspaceOffer(offers, "circ")?.productName, "Círculo Millonario");
  assert.equal(pickWorkspaceOffer(offers, "fert")?.id, "fert");
  assert.equal(pickWorkspaceOffer(offers, "missing"), null);
  assert.equal(pickWorkspaceOffer(offers, ""), null);
});

test("coach labels the closer sees are Spanish", () => {
  assert.equal(closerSpanish("discovery"), "descubrimiento");
  assert.equal(closerSpanish("pitch"), "presentación de la oferta");
  assert.equal(closerSpanish("drill"), "ejercicio");
  assert.equal(closerSpanish("drills"), "ejercicios");
  assert.equal(
    closerSpanish("Acknowledge + Associate + Ask Back"),
    "Reconoce + Relaciona + Devuelve la pregunta",
  );
  assert.equal(closerSpanish("Paid Media"), "Publicidad pagada");
  assert.equal(
    closerSpanish("Solo descubrimiento"),
    "Solo descubrimiento",
  );
});
