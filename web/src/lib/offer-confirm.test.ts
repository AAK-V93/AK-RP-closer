import assert from "node:assert/strict";
import { test } from "node:test";
import { commercialRecap, emptyCommercial } from "./offer-commercial";
import { rephraseOfferQuestion } from "./offer-extract";
import {
  allOfferBlocksConfirmed,
  applyOfferBlockPatch,
  blockDraft,
  confirmKey,
  offerConfirmBlocks,
  OFFER_CONFIRM_BLOCKS,
} from "./offer-confirm";

test("commission block is empty and never assumed", () => {
  const offer = {
    productName: "Mentoría",
    productDescription: "Programa de 6 meses para dueños de agencia.",
    pitchSummary: "",
    icp: "Dueños de agencias de 5 a 20 personas",
    commercial: emptyCommercial(),
  };
  const commission = offerConfirmBlocks(offer).find((row) => row.id === "commission");
  assert.equal(commission?.empty, true);
  assert.match(commission?.summary || "", /No encontré comisión/);
  assert.equal(offer.commercial.commission, null);
});

test("corregir commission stores what the closer wrote, not a default %", () => {
  const offer = {
    productName: "Mentoría",
    productDescription: "Programa de 6 meses para dueños de agencia.",
    pitchSummary: "",
    icp: "",
    commercial: emptyCommercial(),
  };
  const next = applyOfferBlockPatch(
    offer,
    "commission",
    "8% si paga de contado en 7 días; 4% si reserva",
  );
  assert.ok(next.commercial.commission);
  assert.match(next.commercial.commission?.notes || "", /8%/);
  assert.notEqual(next.commercial.commission?.pctBase, 0.03);
});

test("a negative commission question becomes a positive leave-empty question", () => {
  const raw =
    "¿Los porcentajes de comisión del closer no están especificados en el documento?";
  const next = rephraseOfferQuestion(raw);
  assert.match(next, /^No encontré los porcentajes de comisión/);
  assert.match(next, /¿Lo dejo vacío\?$/);
  assert.doesNotMatch(next, /no están/);
  assert.equal(
    rephraseOfferQuestion("La comisión queda en 10% sobre lo cobrado. ¿Es así?"),
    "La comisión queda en 10% sobre lo cobrado. ¿Es así?",
  );
});

test("edited prices keep thousands separators as the real amount", () => {
  const commercial = emptyCommercial();
  commercial.listPrice = 11800;
  commercial.altPrices = [{ label: "Contado especial", amount: 10000 }];
  const offer = {
    productName: "Círculo Millonario",
    productDescription: "",
    pitchSummary: "",
    icp: "",
    commercial,
  };
  const next = applyOfferBlockPatch(offer, "prices", blockDraft(offer, "prices"));
  assert.equal(next.commercial.listPrice, 11800);
  assert.equal(next.commercial.altPrices[0]?.amount, 10000);
});

test("all blocks must be marked before save", () => {
  const confirmed: Record<string, boolean> = {};
  assert.equal(allOfferBlocksConfirmed(1, confirmed), false);
  for (const block of OFFER_CONFIRM_BLOCKS) {
    confirmed[confirmKey(0, block.id)] = true;
  }
  assert.equal(allOfferBlocksConfirmed(1, confirmed), true);
});

test("cash price stays in the recap and plazo is not doubled", () => {
  const commercial = emptyCommercial();
  commercial.listPrice = 11800;
  commercial.altPrices = [{ label: "Precio especial contado 7 días", amount: 10000 }];
  commercial.deadlines = [{ name: "Plazo pago contado 7 días", days: 7, appliesTo: "" }];
  const offer = {
    productName: "Círculo Millonario",
    productDescription: "",
    pitchSummary: "",
    icp: "",
    commercial,
  };
  const prices = offerConfirmBlocks(offer).find((row) => row.id === "prices");
  const payments = offerConfirmBlocks(offer).find((row) => row.id === "payments");
  assert.match(prices?.summary || "", /Si paga de contado en 7 días/);
  assert.match(prices?.summary || "", /USD 10\.000/);
  assert.match(prices?.summary || "", /Precio de lista: USD 11\.800/);
  const special = emptyCommercial();
  special.listPrice = 10000;
  special.altPrices = [
    { label: "Contado especial", amount: 10000 },
    { label: "Contado regular", amount: 11800 },
  ];
  const specialOffer = { ...offer, commercial: special };
  const specialPrices = offerConfirmBlocks(specialOffer).find((row) => row.id === "prices");
  assert.match(specialPrices?.summary || "", /Precio: USD 10\.000/);
  assert.match(specialPrices?.summary || "", /con descuento/);
  assert.match(specialPrices?.summary || "", /mismo que el precio de lista/);
  assert.match(specialPrices?.summary || "", /sin descuento: USD 11\.800/);
  assert.doesNotMatch(specialPrices?.summary || "", /Lista USD 10000/);
  assert.doesNotMatch(payments?.summary || "", /Plazo Plazo/);
  assert.match(commercialRecap(commercial), /10\.000/);
});
