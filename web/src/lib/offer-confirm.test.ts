import assert from "node:assert/strict";
import { test } from "node:test";
import { commercialRecap, emptyCommercial } from "./offer-commercial";
import {
  allOfferBlocksConfirmed,
  applyOfferBlockPatch,
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
  assert.match(prices?.summary || "", /Contado a 7 días/);
  const special = emptyCommercial();
  special.altPrices = [{ label: "Contado con beneficio especial", amount: 10000 }];
  const specialOffer = { ...offer, commercial: special };
  const specialPrices = offerConfirmBlocks(specialOffer).find((row) => row.id === "prices");
  assert.match(specialPrices?.summary || "", /Contado: USD 10000/);
  assert.match(prices?.summary || "", /10000/);
  assert.doesNotMatch(payments?.summary || "", /Plazo Plazo/);
  assert.match(commercialRecap(commercial), /10000/);
});
