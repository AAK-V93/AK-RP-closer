import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OFFER_SAVE_TIMEOUT_MESSAGE,
  offerSavedLabel,
  offerSaveFailureMessage,
} from "./offer-save";

test("a finished save says Guardé la oferta", () => {
  assert.equal(offerSavedLabel(1), "Guardé la oferta");
  assert.equal(offerSavedLabel(2), "Guardé 2 ofertas");
});

test("a stalled save tells the closer to check Ofertas", () => {
  const aborted = new Error("The operation was aborted");
  aborted.name = "TimeoutError";
  assert.equal(offerSaveFailureMessage(aborted), OFFER_SAVE_TIMEOUT_MESSAGE);
  assert.match(offerSaveFailureMessage(new Error("aborted"), true), /Ofertas/);
  assert.equal(
    offerSaveFailureMessage(
      new Error("Nombre y descripción de la oferta son obligatorios"),
    ),
    "Nombre y descripción de la oferta son obligatorios",
  );
});
