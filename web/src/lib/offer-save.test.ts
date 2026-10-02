import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OFFER_SAVE_TIMEOUT_MESSAGE,
  filterPersistableOffers,
  isCompleteOfferSave,
  offerSavedLabel,
  offerSaveFailureMessage,
  postWorkspaceOffer,
} from "./offer-save";

test("a finished save says Guardé la oferta", () => {
  assert.equal(offerSavedLabel(1), "Guardé la oferta");
  assert.equal(offerSavedLabel(2), "Guardé 2 ofertas");
});

test("a short extra offer is not sent to the save route", () => {
  assert.equal(isCompleteOfferSave({ productName: "Fertilidad Consciente", productDescription: "Acompañamiento de fertilidad con precios." }), true);
  assert.equal(isCompleteOfferSave({ productName: "A", productDescription: "corta" }), false);
  const ready = filterPersistableOffers([
    {
      productName: "Fertilidad Consciente",
      productDescription: "Acompañamiento de fertilidad con precios y bonos.",
    },
    { productName: "Oferta 2", productDescription: "corta" },
  ]);
  assert.equal(ready.length, 1);
  assert.equal(ready[0]?.productName, "Fertilidad Consciente");
});

test("an incomplete offer never calls the save route", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("{}", { status: 400 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => postWorkspaceOffer({ productName: "", productDescription: "" }),
      /obligatorios/,
    );
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = original;
  }
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
