import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { offerConfirmBlocks } from "./offer-confirm";
import {
  linesFromTextItems,
  pricesFromOfferText,
  separateMoneyTokens,
} from "./offer-amounts";
import { parsedToBatch, textFromOfferFiles } from "./offer-extract";

test("thousands-dotted amounts do not absorb the next token", () => {
  assert.equal(separateMoneyTokens("USD 1.99769%"), "USD 1.997\n69%");
  const text = linesFromTextItems([
    { str: "USD 1.997", transform: [1, 0, 0, 1, 10, 200] },
    { str: "69% de probabilidad", transform: [1, 0, 0, 1, 80, 200] },
  ]);
  assert.match(text, /USD 1\.997\n69%/);
  assert.deepEqual(pricesFromOfferText("USD 1.997\n69% de probabilidad").altPrices.map((row) => row.amount), [1997]);
  assert.equal(pricesFromOfferText("USD 1.99769%").listPrice, null);
  assert.ok(!pricesFromOfferText("USD 1.99769%").altPrices.some((row) => row.amount === 199769));
});

test("fertilidad consciente keeps real prices and drops the success rate", async () => {
  const buffer = readFileSync(new URL("./fixtures/oferta-fertilidad-consciente.pdf", import.meta.url));
  const read = await textFromOfferFiles([
    {
      name: "oferta-fertilidad-consciente.pdf",
      mime: "application/pdf",
      buffer,
    },
  ]);
  assert.match(read.text, /Fertilidad Consciente/);
  assert.match(read.text, /USD 1\.597/);
  assert.match(read.text, /USD 1\.997/);
  assert.match(read.text, /USD 533/);
  assert.match(read.text, /Precio especial — Solo hoy: USD 1\.597/);
  assert.match(read.text, /Precio regular: USD 1\.997/);
  assert.match(read.text, /3 cuotas de: USD 533/);
  assert.doesNotMatch(read.text, /199\.769|199769/);
  assert.doesNotMatch(read.text, /1\.99769/);

  const batch = parsedToBatch(
    {
      assumption: "una",
      questions: ["La comisión queda en 69% sobre lo cobrado. ¿Es así?"],
      offers: [
        {
          productName: "Fertilidad Consciente",
          productDescription:
            "Programa de 12 semanas para parejas que quieren preparar el cuerpo antes del siguiente intento.",
          listPrice: 199769,
          currency: "USD",
          altPrices: [{ label: "Precio de lista", amount: 199769 }],
          commission: {
            notes: "69% sobre lo cobrado",
            pctBase: 0.69,
            tiers: [{ when: "siempre", label: "tramo", pct: 0.69 }],
          },
          bonuses: [],
        },
      ],
    },
    "Oferta",
    read.text,
  );
  const offer = batch.offers[0];
  assert.equal(offer?.productName, "Fertilidad Consciente");
  assert.equal(offer?.commercial.commission, null);
  assert.match(batch.questions.join(" "), /No encontré un porcentaje de comisión/);
  assert.match(batch.questions.join(" "), /¿La dejo vacía\?/);
  assert.doesNotMatch(batch.questions.join(" "), /69\s*%/);
  const amounts = [
    offer?.commercial.listPrice,
    ...(offer?.commercial.altPrices.map((row) => row.amount) || []),
  ];
  assert.ok(amounts.includes(1597), amounts.join(","));
  assert.ok(amounts.includes(1997), amounts.join(","));
  assert.ok(amounts.includes(533), amounts.join(","));
  assert.equal(amounts.includes(199769), false);
  const prices = offerConfirmBlocks(offer!).find((row) => row.id === "prices");
  assert.match(prices?.summary || "", /1\.597/);
  assert.match(prices?.summary || "", /1\.997/);
  assert.match(prices?.summary || "", /533/);
  assert.doesNotMatch(prices?.summary || "", /199\.769|69\s*%/);
  const blocks = offerConfirmBlocks(offer!);
  assert.equal(blocks.some((row) => row.id === "commission"), false);
  assert.equal(blocks.some((row) => row.id === "bonuses"), false);
});
