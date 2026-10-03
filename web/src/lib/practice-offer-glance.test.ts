import assert from "node:assert/strict";
import { test } from "node:test";
import { practiceOfferGlance, practiceOfferLoadState, shortOfferBlurb } from "./practice-offer-glance";

test("the practice drawer does not repeat the raw PDF", () => {
  const raw =
    "Fertilidad Consciente Sistema Fertilidad de Raíz Tu cuerpo no te está fallando. El programa acompaña el ciclo con tres precios y diez bonos incluidos en el documento completo que sigue por páginas.";
  const blurb = shortOfferBlurb({
    productName: "Fertilidad Consciente",
    productDescription: raw,
    pitchSummary: "",
  });
  assert.ok(!blurb.startsWith("Fertilidad Consciente Sistema"));
  assert.match(blurb, /Tu cuerpo no te está fallando/);
  assert.ok(blurb.length < 200);
});

test("a short pitch wins over the document", () => {
  assert.equal(
    shortOfferBlurb({
      productName: "Fertilidad Consciente",
      productDescription: "texto larguísimo del pdf ".repeat(40),
      pitchSummary: "Acompañamiento para entender el ciclo y cerrar con calma.",
    }),
    "Acompañamiento para entender el ciclo y cerrar con calma.",
  );
});

test("the glance lists prices and a bonus count", () => {
  const glance = practiceOfferGlance({
    productName: "Fertilidad Consciente",
    productDescription: "Tu cuerpo no te está fallando. El resto del pdf.",
    commercial: {
      currency: "USD",
      listPrice: 1997,
      altPrices: [{ label: "Lanzamiento", amount: 1597 }],
      bonuses: Array.from({ length: 10 }, (_, index) => ({
        name: `Bono ${index + 1}`,
        condition: "",
      })),
    },
  });
  assert.ok(glance.prices.some((line) => line.includes("1.997") || line.includes("1997")));
  assert.equal(glance.bonusCount, 10);
  assert.equal(glance.bonusNames[0], "Bono 1");
  assert.ok(glance.blurb.length < 200);
});

test("a failed practice offer read is not an empty offer", () => {
  assert.equal(practiceOfferLoadState({ ok: false, offer: undefined }), "error");
  assert.equal(practiceOfferLoadState({ ok: false, offer: { id: "x" } }), "error");
  assert.equal(practiceOfferLoadState({ ok: true, offer: null }), "empty");
  assert.equal(practiceOfferLoadState({ ok: true, offer: { id: "circulo" } }), "ready");
});
