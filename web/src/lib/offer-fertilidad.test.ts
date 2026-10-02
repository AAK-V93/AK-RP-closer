import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { describeOfferPrices, emptyCommercial } from "./offer-commercial";
import { offerConfirmBlocks } from "./offer-confirm";
import {
  linesFromTextItems,
  pricesFromOfferText,
  separateMoneyTokens,
} from "./offer-amounts";
import { extractOfferBatchFromInput, heuristicBatch, parsedToBatch, textFromOfferFiles } from "./offer-extract";

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

test("the QA price block keeps the launch price, the list price and the plan", () => {
  const text = [
    "Precio especial — Solo hoy",
    "Precio regular",
    "USD 1.597",
    "USD 1.997",
    "o 3 cuotas de USD 533",
    "69% de probabilidad de éxito",
  ].join("\n");
  const found = pricesFromOfferText(text);
  const commercial = emptyCommercial();
  commercial.listPrice = found.listPrice;
  commercial.altPrices = found.altPrices;
  const summary = describeOfferPrices(commercial);
  assert.equal(found.listPrice, 1997);
  assert.match(summary, /Precio especial: USD 1\.597/);
  assert.match(summary, /Precio de lista: USD 1\.997/);
  assert.match(summary, /3 cuotas de USD 533/);
  assert.doesNotMatch(summary, /199\.769|69\s*%/);
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
  assert.match(read.text, /^Bonus incluidos$/m);
  assert.ok(read.text.indexOf("USD 1.597") > 8000, String(read.text.indexOf("USD 1.597")));
  assert.ok(read.text.length > 8600 && read.text.length < 9500, String(read.text.length));
  assert.match(read.text, /USD 1\.597/);
  assert.match(read.text, /USD 1\.997/);
  assert.match(read.text, /USD 533/);
  assert.doesNotMatch(read.text, /199\.769|199769/);
  assert.doesNotMatch(read.text, /1\.99769/);
  assert.doesNotMatch(read.text, /^Bonus:/m);

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
  const summary = prices?.summary || "";
  assert.match(summary, /Precio especial: USD 1\.597/);
  assert.match(summary, /Precio de lista: USD 1\.997/);
  assert.match(summary, /3 cuotas de USD 533/);
  assert.doesNotMatch(summary, /199\.769|69\s*%/);
  assert.equal(offer?.commercial.listPrice, 1997);
  const blocks = offerConfirmBlocks(offer!);
  assert.equal(blocks.some((row) => row.id === "commission"), false);
  const bonuses = blocks.find((row) => row.id === "bonuses");
  assert.ok(bonuses);
  assert.equal(offer?.commercial.bonuses.length, 10);
  assert.match(bonuses?.summary || "", /Protocolo de suplementación en pareja personalizado/);
  assert.match(bonuses?.summary || "", /productos libre de toxicos/);
  assert.match(bonuses?.summary || "", /Masterclass: Mi fertilidad/);
  assert.match(bonuses?.summary || "", /E-book etiquetas/);
  assert.match(bonuses?.summary || "", /Retos dentro de las comunidades/);
  assert.doesNotMatch(bonuses?.summary || "", /3 sesiones 1:1/);
  assert.doesNotMatch(bonuses?.summary || "", /GARANTÍA|garant[ií]a total/i);
  assert.doesNotMatch(bonuses?.summary || "", /No es un bonus/);
});

/** Linear unpdf extractText layout, padded like the 8892-char production read. */
function fertilidadExtractText() {
  const preceding = [
    "Fertilidad Consciente",
    "Sistema Fertilidad de Raíz",
    "Tu cuerpo no te está fallando. Está pidiendo ser escuchado diferente.",
    "Paola Sánchez",
    "Nutricionista especializada en salud hormonal y fertilidad",
    "¿Es para ti Fertilidad Consciente?",
    "Te han dicho que todo está bien, pero aún no logras quedar embarazada.",
    "No es un bonus.",
    "Trabaja a él y ella en paralelo, en pareja",
    "Las 12 semanas: el camino paso a paso",
    "Sem. 0–1: Diagnóstico funcional",
  ].join("\n");
  const fillerLine =
    "Acompañamiento de nutrición funcional, sueño y estrés para la pareja, semana a semana.";
  const headParts = [preceding];
  while (headParts.join("\n").length < 6400) headParts.push(fillerLine);
  const head = headParts.join("\n");
  const tail = `
Tu inversión incluye todo esto
Núcleo del programa
3 sesiones 1:1 con Paola Sánchez (cita inicial y re-evaluación)
Taller individual de etiquetado nutricional con experta en el equipo, en
tiempo real desde casa o el supermercado
5 sesiones grupales con Paola Sánchez (rangos funcionales, microbiota
intestinal, alimentación y suplementación)
3 sesiones grupales con psicóloga clínica gestáltica
1 sesión grupal con ginecólogo especialista en fertilidad
1 sesión grupal con experta en disruptores hormonales
Plan antiinflamatorio 100% personalizado para él y ella: menú 30 días +
recetario funcional
Calendario de 90 días para mejorar tu fertilidad
Plataforma con información grabada
Acompañamiento 100% personalizado y privado vía WhatsApp y
plataforma
Acceso a la plataforma por 2 años
Bonus incluidos
Protocolo de suplementación en pareja personalizado
Detox del entorno completo: test de disruptores hormonales + lista de
productos libre de toxicos
Comunidad privada de pareja + check-list semanal
Guía de rangos óptimos vs rangos tradicionales en pareja
Guía de respiración, meditación y manejo de estrés
Masterclass: vida sin tóxicos con experto en vida sin toxico
Masterclass: Mi fertilidad desde la ginecología con el experto en fertilidad
Mini curso de salsas y aderezos, para que comer ensalada sea delicioso
E-book etiquetas sin engaños para tus hormonas
Retos dentro de las comunidades con premios exclusivos
🏅 GARANTÍA TOTAL: Extensión del acompañamiento sin costo
Si al finalizar las 12 semanas no ves resultados, extendemos tu acompañamiento sin costo adicional.
TASA DE ÉXITO DEL PROGRAMA
69% casos de éxito de
nuestro programa
Tu próximo paso
La inversión que cambia el terreno antes de internarlo de manera natural o asistido
Programa completo 12 semanas
USD 1.997
69% de probabilidad de éxito. Preparación del cuerpo medible y verificable en 90 días — antes de tu próximo intento.
Decide Hoy. Cambia el Rumbo.
Si tomas acción ahora, en esta llamada, accedes al precio especial de lanzamiento. Esta oferta no estará disponible después de
colgar.
Programa completo 12 semanas
Precio regular
USD 1.997
Precio especial — Solo hoy
USD 1.597
o 3 cuotas de USD 533
Acceso inmediato · 12 semanas · Acompañamiento
completo
69% de probabilidad de éxito comprobada. Cuerpo preparado de forma medible en 90 días — antes de tu próximo intento
natural o asistido. Sin riesgo: si no ves cambios, extendemos el acompañamiento.
`.trim();
  return `${head}\n${tail}`;
}

function listOnlyModel() {
  return JSON.stringify({
    assumption: "una",
    questions: ["La comisión queda en 69% sobre lo cobrado. ¿Es así?"],
    offers: [
      {
        productName: "Fertilidad Consciente",
        icp: "Parejas que preparan el cuerpo antes del siguiente intento.",
        productDescription:
          "Programa de 12 semanas para parejas que quieren preparar el terreno de forma medible antes de un intento natural o asistido.",
        listPrice: 1997,
        currency: "USD",
        altPrices: [],
        paymentModes: [{ name: "Cuotas", details: "" }],
        bonuses: [],
        commission: {
          notes: "69% sobre lo cobrado",
          pctBase: 0.69,
          tiers: [{ when: "siempre", label: "tramo", pct: 0.69 }],
        },
      },
    ],
  });
}

test("the API extract keeps the price tail and the bonus list when the model returns only the list price", async () => {
  const text = fertilidadExtractText();
  assert.ok(text.length > 8800 && text.length < 9800, String(text.length));
  assert.ok(text.indexOf("Bonus incluidos") > 6000);
  assert.ok(text.indexOf("USD 1.597") > 8200, String(text.indexOf("USD 1.597")));
  assert.ok(text.includes("No es un bonus."));

  let seen = "";
  const batch = await extractOfferBatchFromInput({
    text,
    complete: async (parts) => {
      seen = parts.map((part) => ("text" in part ? String(part.text || "") : "")).join("\n");
      return listOnlyModel();
    },
  });
  const doc = seen.split("--- TEXTO ---")[1] || "";
  assert.ok(doc.includes("USD 1.597"));
  assert.ok(doc.includes("Bonus incluidos"));
  assert.ok(doc.indexOf("USD 1.597") > 8000, String(doc.indexOf("USD 1.597")));
  assert.ok(doc.length > 8800, String(doc.length));

  const offer = batch.offers[0];
  assert.equal(offer?.commercial.listPrice, 1997);
  assert.equal(offer?.commercial.commission, null);
  assert.ok((offer?.commercial.sourceText.length || 0) > 8000);
  assert.match(offer?.commercial.sourceText || "", /USD 1\.597/);
  const prices = offerConfirmBlocks(offer!).find((row) => row.id === "prices");
  assert.match(prices?.summary || "", /Precio especial: USD 1\.597/);
  assert.match(prices?.summary || "", /Precio de lista: USD 1\.997/);
  assert.match(prices?.summary || "", /3 cuotas de USD 533/);
  assert.doesNotMatch(prices?.summary || "", /199\.769|69\s*%/);
  const bonuses = offerConfirmBlocks(offer!).find((row) => row.id === "bonuses");
  assert.equal(offer?.commercial.bonuses.length, 10);
  assert.match(bonuses?.summary || "", /Protocolo de suplementación en pareja personalizado/);
  assert.match(bonuses?.summary || "", /Detox del entorno completo: test de disruptores hormonales \+ lista de productos libre de toxicos/);
  assert.match(bonuses?.summary || "", /Retos dentro de las comunidades con premios exclusivos/);
  assert.doesNotMatch(bonuses?.summary || "", /GARANTÍA|Núcleo del programa|3 sesiones 1:1|No es un bonus/i);
  assert.match(batch.questions.join(" "), /No encontré un porcentaje de comisión/);
  assert.doesNotMatch(batch.questions.join(" "), /69\s*%/);

  const failed = heuristicBatch(text);
  const failedPrices = offerConfirmBlocks(failed.offers[0]!).find((row) => row.id === "prices");
  assert.match(failedPrices?.summary || "", /Precio especial: USD 1\.597/);
  assert.match(failedPrices?.summary || "", /3 cuotas de USD 533/);
  assert.equal(failed.offers[0]?.commercial.bonuses.length, 10);
  assert.equal(failed.offers[0]?.commercial.commission, null);
});
