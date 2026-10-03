import assert from "node:assert/strict";
import { test } from "node:test";
import { displayCallTitle } from "./fathom-import";
import { clipVisible } from "./visible-text";

test("visible clips mark a cut and skip a dangling word", () => {
  const cut = clipVisible("Devuelve la pregunta durante el silencio largo", 32);
  assert.equal(cut.endsWith("…"), true);
  assert.equal(cut.endsWith(" el…"), false);
  assert.equal(cut.endsWith(" de…"), false);
  assert.equal(cut.endsWith(" la…"), false);
  assert.equal(clipVisible("Mentoría", 40), "Mentoría");
});

test("call titles keep the lead and the offer whole", () => {
  const lead = "Sofía Mamani Quispe de la Torre";
  const offer = "Mentoría de Alto Valor para Equipos Comerciales";
  assert.equal(displayCallTitle({ leadName: lead, offerName: offer }), `${lead} · ${offer}`);
  assert.equal(displayCallTitle({ leadName: lead }), lead);
  assert.equal(displayCallTitle({ offerName: offer }), offer);
});
