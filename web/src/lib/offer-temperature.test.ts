import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyExtractor, extractorGap } from "./extractor";
import { learningRates } from "./extractor-feedback";
import {
  leadTemperature,
  scriptTemperatureFit,
  temperatureRank,
} from "./lead-temperature";
import {
  amountBandsFromFeedback,
  resolveOfferAssignment,
  type OfferSignal,
} from "./offer-resolve";

const OFFERS: OfferSignal[] = [
  { productName: "Mentoría Norte", aliases: ["Norte"], prices: [12000, 9000] },
  { productName: "Acelerador Sur", aliases: ["Sur"], prices: [8000] },
];

test("a named offer in the call is assigned without asking", () => {
  const out = resolveOfferAssignment({
    offers: OFFERS,
    transcript: "Hablamos del programa Mentoría Norte y quedó en pensarlo.",
    amounts: [],
  });
  assert.equal(out.producto, "Mentoría Norte");
  assert.equal(out.confidence, 95);
  assert.equal(out.ask, false);
});

test("a unique price assigns that offer", () => {
  const out = resolveOfferAssignment({
    offers: OFFERS,
    transcript: "El ticket quedó en ocho mil.",
    amounts: [8000],
  });
  assert.equal(out.producto, "Acelerador Sur");
  assert.equal(out.ask, false);
});

test("a price shared by two offers asks instead of guessing", () => {
  const shared: OfferSignal[] = [
    { productName: "Alfa", aliases: [], prices: [10000] },
    { productName: "Beta", aliases: [], prices: [10000] },
  ];
  const out = resolveOfferAssignment({
    offers: shared,
    transcript: "Quedó en diez mil.",
    amounts: [10000],
  });
  assert.equal(out.producto, null);
  assert.equal(out.ask, true);
  assert.deepEqual(out.options, ["Alfa", "Beta"]);
});

test("no name and no amount does not default to the first offer", () => {
  const out = resolveOfferAssignment({
    offers: OFFERS,
    transcript: "Hablamos de su empresa y quedó en pensarlo.",
    amounts: [],
  });
  assert.equal(out.producto, null);
  assert.equal(out.ask, true);
  assert.deepEqual(out.options, ["Mentoría Norte", "Acelerador Sur"]);
});

test("the same amount corrected twice assigns that offer next time", () => {
  const learned = amountBandsFromFeedback([
    { valorExtraido: "MONTO:9500", valorCorregido: "Mentoría Norte" },
    { valorExtraido: "MONTO:9600", valorCorregido: "Mentoría Norte" },
  ]);
  const out = resolveOfferAssignment({
    offers: OFFERS,
    transcript: "Negociamos un número que no está en la lista.",
    amounts: [9500],
    learned,
  });
  assert.equal(out.producto, "Mentoría Norte");
  assert.equal(out.confidence, 90);
  assert.equal(out.ask, false);
});

test("one amount correction is not enough to auto-assign", () => {
  const learned = amountBandsFromFeedback([
    { valorExtraido: "MONTO:9500", valorCorregido: "Mentoría Norte" },
  ]);
  const out = resolveOfferAssignment({
    offers: OFFERS,
    transcript: "Sin nombre de programa.",
    amounts: [9500],
    learned,
  });
  assert.equal(out.producto, null);
  assert.equal(out.ask, true);
});

test("the offer question uses chips and comes before the follow-up date", () => {
  const parsed = emptyExtractor();
  parsed.cliente_real = "Alberto";
  parsed.estado_agenda = "SHOW";
  parsed.confianza.cliente_real = 95;
  parsed.confianza.estado_agenda = 95;
  parsed.requiere_seguimiento = true;
  parsed.tipo_seguimiento = "DECISION";
  const gap = extractorGap(parsed, true, OFFERS);
  assert.equal(gap?.field, "producto");
  assert.match(gap?.question || "", /Alberto/);
  assert.deepEqual(gap?.options, ["Mentoría Norte", "Acelerador Sur"]);
});

test("hot lead outranks a cold one", () => {
  const hot = leadTemperature({
    enJuego: 8000,
    silenceDays: 0,
    calificado: true,
    objectionOpen: false,
    decisionDate: true,
    intentos: 0,
  });
  const cold = leadTemperature({
    enJuego: 0,
    silenceDays: 20,
    calificado: false,
    objectionOpen: true,
    decisionDate: false,
    intentos: 4,
  });
  assert.equal(hot.level, "alto");
  assert.equal(cold.level, "bajo");
  assert.ok(temperatureRank(hot.level) > temperatureRank(cold.level));
});

test("a cold lead prefers the no-answer script over a decision script", () => {
  const cold = scriptTemperatureFit(
    { type: "RETOMAR", key: "llamada-en-frio", recomendacion: "no contestan" },
    "bajo",
  );
  const hot = scriptTemperatureFit(
    { type: "DECISION", key: "premonicion", recomendacion: "cierre" },
    "bajo",
  );
  assert.ok(cold > hot);
});

test("coach rates count auto offer detection and temperature hits", () => {
  const rates = learningRates({
    calls: [
      { id: "a", offerName: "Norte", estadoAgenda: "SHOW" },
      { id: "b", offerName: "Sur", estadoAgenda: "SHOW" },
      { id: "c", offerName: "", estadoAgenda: "SHOW" },
    ],
    feedback: [
      {
        callRecordId: "c",
        campo: "producto",
        valorExtraido: "MONTO:8000",
        valorCorregido: "Sur",
      },
      {
        callRecordId: "x",
        campo: "temperatura",
        valorExtraido: "alto",
        valorCorregido: "alto",
      },
      {
        callRecordId: "y",
        campo: "temperatura",
        valorExtraido: "bajo",
        valorCorregido: "alto",
      },
    ],
  });
  assert.equal(rates.offerAutoPct, 67);
  assert.equal(rates.temperatureHitPct, 50);
});
