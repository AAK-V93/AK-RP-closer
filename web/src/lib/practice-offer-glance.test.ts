import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  offerPracticeMaterialLine,
  offerSwitchLabel,
  practiceOfferGlance,
  practiceOfferLoadState,
  shortOfferBlurb,
} from "./practice-offer-glance";

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

test("a clipped offer blurb ends on the ellipsis, not a dangling word", () => {
  const blurb = shortOfferBlurb({
    productName: "Oferta",
    productDescription:
      "El programa acompaña el ciclo con tres precios y diez bonos incluidos en el documento completo que sigue por páginas y páginas de detalle comercial antes de cerrar la propuesta con el cliente.",
    pitchSummary: "",
  });
  assert.match(blurb, /…$/);
  assert.doesNotMatch(blurb, / (el|de|la|en|con)…$/);
  assert.ok(!blurb.toLowerCase().includes("oferta el programa"));
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

test("an offer chip names the bonuses and does not end on a hanging dot", () => {
  assert.equal(offerSwitchLabel("Círculo Millonario", 2), "Círculo Millonario · 2 bonos");
  assert.equal(offerSwitchLabel("Fertilidad Consciente", 1), "Fertilidad Consciente · 1 bono");
  assert.equal(offerSwitchLabel("Círculo Millonario", 0), "Círculo Millonario");
  assert.equal(offerSwitchLabel("  ", 0), "Oferta");
  assert.equal(offerSwitchLabel("Círculo Millonario", 0).endsWith("·"), false);
  assert.equal(offerSwitchLabel("Círculo Millonario", 2).endsWith("·"), false);
});

test("Ir a practicar sits on the offer title and carries the active offer", () => {
  const page = readFileSync(new URL("../app/ofertas/page.tsx", import.meta.url), "utf8");
  const header = page.slice(page.indexOf("<h1"), page.indexOf("</h1>"));
  assert.match(header, /Ofertas/);
  assert.doesNotMatch(header, /Ir a practicar/);
  const card = page.slice(page.indexOf('aria-label="Datos de la oferta"'), page.indexOf("Añadir / pegar oferta"));
  assert.match(card, /productName \|\| "Oferta"/);
  assert.match(card, /Ir a practicar/);
  assert.match(card, /\/practicar\?offerId=\$\{encodeURIComponent\(offerId\)\}/);
  assert.doesNotMatch(card, /href="\/practicar"/);
  const uploadAt = page.indexOf("Subir carpeta");
  const toggleAt = page.indexOf("Añadir llamadas");
  assert.ok(toggleAt > 0 && uploadAt > toggleAt);
  assert.match(page, /showCallUpload \? "Ocultar formulario" : "Añadir llamadas"/);
  assert.match(page, /readableTitle\(row\.title\)/);
  assert.match(page, /setCallsForOffer\(null\)/);
  assert.match(page, /transcripts: \[\]/);
  assert.match(page, /aria-label="Cargando llamadas"/);
  assert.match(page, /callRows = callsPending \? \[\]/);
});

test("a tab change does not keep the previous offer's calls, and practice reads offerId", () => {
  const form = readFileSync(new URL("../components/training-setup-form.tsx", import.meta.url), "utf8");
  assert.match(form, /searchParams\.get\("offerId"\)/);
  assert.match(form, /\/api\/workspace\$\{query\}/);
});

test("practice uses the Ofertas material line in the panel and the phone drawer", () => {
  const form = readFileSync(new URL("../components/training-setup-form.tsx", import.meta.url), "utf8");
  const drawer = readFileSync(
    new URL("../components/configuration-form-drawer.tsx", import.meta.url),
    "utf8",
  );
  const chat = readFileSync(new URL("../components/chat.tsx", import.meta.url), "utf8");
  assert.match(form, /offerPracticeMaterialLine\(/);
  assert.match(form, /fathomCount/);
  assert.match(form, /includeFathom: Boolean\(offer\.includeFathom\)/);
  assert.match(form, /perfil de prospectos listo/);
  assert.doesNotMatch(form, /llamada real/);
  assert.doesNotMatch(form, /llamadas reales/);
  assert.doesNotMatch(form, /emulando a tus prospectos/);
  assert.match(drawer, /<TrainingSetupForm \/>/);
  assert.match(chat, /El prospecto emula tus transcripciones y grabaciones\./);
  assert.doesNotMatch(chat, /llamadas reales/);
});

test("ofertas names imported texts and recordings apart from Coach person calls", () => {
  assert.deepEqual(
    offerPracticeMaterialLine({ transcriptCount: 197, fathomCount: 191, includeFathom: true }),
    {
      line: "6 transcripciones y 191 grabaciones para practicar esta oferta (197 en total). Las llamadas con persona están en Coach.",
      imported: 6,
      recordings: 191,
    },
  );
  assert.deepEqual(offerPracticeMaterialLine({ transcriptCount: 1, fathomCount: 191, includeFathom: false }), {
    line: "1 transcripción para practicar esta oferta.",
    imported: 1,
    recordings: 0,
  });
  assert.equal(
    offerPracticeMaterialLine({ transcriptCount: 191, fathomCount: 191, includeFathom: true }).line,
    "191 grabaciones para practicar esta oferta. Las llamadas con persona están en Coach.",
  );
  assert.equal(
    offerPracticeMaterialLine({ transcriptCount: 0, fathomCount: 0, includeFathom: true }).line,
    "Todavía no hay transcripciones ni grabaciones para practicar.",
  );
  assert.equal(
    offerPracticeMaterialLine({ transcriptCount: 6, fathomCount: 191, includeFathom: true }).imported,
    6,
  );
});

test("the Oferta sheet uses dark-surface ink and an inverted voice chip", () => {
  const drawer = readFileSync(new URL("../components/ui/drawer.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("../components/training-setup-form.tsx", import.meta.url), "utf8");
  const label = readFileSync(new URL("../components/ui/label.tsx", import.meta.url), "utf8");
  const sheet = drawer.slice(drawer.indexOf("const DrawerContent"), drawer.indexOf("DrawerContent.displayName"));
  assert.match(sheet, /dark /);
  assert.match(sheet, /bg-background/);
  assert.match(sheet, /text-foreground/);
  assert.doesNotMatch(sheet, /bg-neutral-800/);
  assert.match(label, /text-foreground/);
  assert.match(form, /Idioma del prospecto/);
  assert.match(form, /Voz del prospecto/);
  assert.match(form, /Inventa un comprador con el comportamiento de los prospectos de esta/);
  assert.match(form, /text-\[11px\] text-fg3/);
  assert.match(form, /rounded-full bg-fg0 px-3 text-sm font-medium text-bg0/);
  assert.doesNotMatch(form, /text-\[#FBF8F2\]/);
  assert.match(form, /rounded-full border border-separator2 bg-bg0 px-3 text-sm text-fg0/);
});

test("a failed practice offer read is not an empty offer", () => {
  assert.equal(practiceOfferLoadState({ ok: false, offer: undefined }), "error");
  assert.equal(practiceOfferLoadState({ ok: false, offer: { id: "x" } }), "error");
  assert.equal(practiceOfferLoadState({ ok: true, offer: null }), "empty");
  assert.equal(practiceOfferLoadState({ ok: true, offer: { id: "circulo" } }), "ready");
});
