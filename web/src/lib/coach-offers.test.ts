import assert from "node:assert/strict";
import { test } from "node:test";
import { outcomeSentences } from "./outcome-counts";
import { buildCoachOffers, type CoachEvidence } from "./coach-offers";

const NOW = new Date("2026-10-05T15:00:00Z");

test("este mes matches Inicio and the historical pile stays labeled apart", () => {
  const calls: CoachEvidence[] = [
    { id: "a", cliente: "Ana Salas", fecha: "2026-10-02", estadoAgenda: "CIERRE VENTA", oferta: "Círculo Millonario" },
    {
      id: "m",
      cliente: "Marco Ruiz",
      fecha: "2026-10-01",
      estadoAgenda: "SHOW",
      oferta: "Círculo Millonario",
      razonNoCierre: "lo tiene que consultar",
    },
    {
      id: "l",
      cliente: "Lucía Vega",
      fecha: "2026-10-03",
      estadoAgenda: "SHOW",
      oferta: "Fertilidad Consciente",
      razonNoCierre: "precio",
    },
    { id: "e", cliente: "Elber", fecha: "2026-10-03", estadoAgenda: "SHOW", oferta: "Círculo Millonario" },
    {
      id: "old",
      cliente: "Paula Ríos",
      fecha: "2026-09-02",
      estadoAgenda: "SHOW",
      oferta: "Círculo Millonario",
      razonNoCierre: "lo tiene que consultar",
    },
  ];
  const board = buildCoachOffers({ calls, offerNames: ["Círculo Millonario", "Fertilidad Consciente"], now: NOW });
  const inicio = outcomeSentences({ won: 1, lost: 2 }).versus;
  assert.equal(board.monthVersus, inicio);
  assert.equal(board.monthVersus, "1 cerrado · 2 perdidos");
  assert.equal(board.monthCalls, "4 llamadas este mes");
  const circulo = board.offers.find((row) => row.offerName === "Círculo Millonario");
  assert.equal(circulo?.monthVersus, "1 cerrado · 1 perdido");
  assert.equal(circulo?.monthCalls, "3 llamadas este mes");
  assert.match(circulo?.historyVersus || "", /1 cerrado · 2 perdidos/);
  assert.equal(circulo?.historyCalls, "4 llamadas");
  assert.equal(board.objection?.text, "lo tiene que consultar");
  assert.equal(board.objection?.periodLabel, "Este mes");
  assert.equal(board.objection?.people, 1);
});

test("a September close is histórico, not este mes, and Otro is not the objection", () => {
  const board = buildCoachOffers({
    now: NOW,
    calls: [
      { id: "old", cliente: "Lucía Vega", fecha: "2026-09-02", estadoAgenda: "CIERRE VENTA", oferta: "Círculo Millonario" },
      {
        id: "x",
        cliente: "Marco",
        fecha: "2026-09-04",
        estadoAgenda: "SHOW",
        oferta: "Círculo Millonario",
        razonNoCierre: "Otro",
      },
      {
        id: "y",
        cliente: "Ana",
        fecha: "2026-09-08",
        estadoAgenda: "SHOW",
        oferta: "Círculo Millonario",
        razonNoCierre: "lo consultó con su socio",
      },
    ],
  });
  assert.equal(board.monthVersus, "0 cerrados · 0 perdidos");
  assert.equal(board.monthCalls, "");
  assert.match(board.offers[0]?.historyVersus || "", /1 cerrado/);
  assert.equal(board.objection?.text, "lo consultó con su socio");
  assert.equal(board.objection?.periodLabel, "Histórico");
});

test("no classified call stays empty instead of a fake zero", () => {
  const board = buildCoachOffers({
    now: NOW,
    calls: [{ id: "e", cliente: "Elber", fecha: "2026-10-03", oferta: "Círculo Millonario" }],
  });
  assert.equal(board.monthVersus, "");
  assert.equal(board.monthCalls, "1 llamada este mes");
  assert.equal(board.objection, null);
});
