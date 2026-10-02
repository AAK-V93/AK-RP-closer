import assert from "node:assert/strict";
import { test } from "node:test";
import { rollupCalls } from "./crm-rollup";
import { zonedDayKey, zonedMonthRange } from "./crm-time";
import { inferCallDate, pastedCallTitle, quickFollowupIso } from "./followup-date";
import { catalogDisplayName, isPriceLabel, preferOfferName } from "./offer-name";
import { operacionFromCall } from "./crm-operacion";

const QA_TRANSCRIPT = `[QA PRUEBA] Llamada de venta 30/09/2026. Closer: Kali. Lead: Carlos Ramírez (QA), dueño de Ferretería El Tornillo.
Kali: La inversión es de 10,000 USD si pagas al contado esta semana, con inicial de 3,000.`;

const PASTE_AT = new Date("2026-10-02T02:20:00.000Z");

test("a paste at 21:20 Bogotá is still 1/10, and the transcript date wins", () => {
  assert.equal(zonedDayKey(PASTE_AT), "2026-10-01");
  assert.equal(inferCallDate(QA_TRANSCRIPT, PASTE_AT)?.toISOString().slice(0, 10), "2026-09-30");
  const title = pastedCallTitle(QA_TRANSCRIPT, PASTE_AT);
  assert.match(title, /Carlos Ramírez/);
  assert.match(title, /30\/9\/2026/);
  assert.doesNotMatch(title, /2\/10\/2026/);
  assert.equal(
    pastedCallTitle("Hablamos un rato y no quedó ninguna fecha escrita en el texto.", PASTE_AT),
    "Pegado 1/10/2026",
  );
});

test("hoy just before midnight in Bogotá is still that calendar day", () => {
  assert.equal(quickFollowupIso("hoy", PASTE_AT), "2026-10-01");
  assert.equal(quickFollowupIso("manana", PASTE_AT), "2026-10-02");
});

test("September in Bogotá includes the instant that is already October in UTC", () => {
  const lateSeptember = new Date("2026-10-01T02:30:00.000Z");
  const september = zonedMonthRange(lateSeptember);
  assert.equal(september.key, "2026-09");
  assert.equal(zonedDayKey(lateSeptember), "2026-09-30");
  assert.ok(lateSeptember >= september.from && lateSeptember < september.to);
  const october = zonedMonthRange(PASTE_AT);
  assert.equal(october.key, "2026-10");
  assert.equal(zonedMidnightCheck(), "2026-10-01T05:00:00.000Z");
});

function zonedMidnightCheck() {
  return zonedMonthRange(new Date("2026-10-15T17:00:00.000Z")).from.toISOString();
}

test("the call date shown in Operación uses Bogotá, not the UTC day", () => {
  const row = operacionFromCall({
    id: "paste",
    recordedAt: PASTE_AT,
    leadName: "Carlos Ramírez",
    estadoAgenda: "ACUERDO SIN PAGO",
  });
  assert.equal(row.fecha, "2026-10-01");
});

test("Ventas drops the year 2026 and the desglose uses the real offer name", () => {
  assert.equal(isPriceLabel("Lista USD 11800 · Contado especial USD 10000"), true);
  assert.equal(
    preferOfferName("Círculo Millonario", "Lista USD 11800 · Contado especial USD 10000"),
    "Círculo Millonario",
  );
  assert.equal(
    catalogDisplayName(
      {
        productName: "Lista USD 11800 · Contado especial USD 10000",
        productDescription: "",
      },
      ["Círculo Millonario"],
    ),
    "Círculo Millonario",
  );
  assert.equal(
    catalogDisplayName(
      {
        productName: "Quedamos en que el viernes",
        productDescription: "El chat escribió el acuerdo aquí y no es una oferta.",
      },
      ["Círculo Millonario"],
    ),
    "",
  );
  const offers = [
    {
      productName: "Lista USD 11800 · Contado especial USD 10000",
      productDescription: "Círculo Millonario. Mentoría de 6 meses con el Método 5E.",
      aliases: [],
      prices: [11800, 10000],
    },
    {
      productName: "Quedamos en que el viernes",
      productDescription: "El chat escribió el acuerdo aquí y no es una oferta.",
      aliases: [],
      prices: [],
    },
  ];
  const calls = ["Carlos", "Lucía", "Andrea", "Diego"].map((name, index) => ({
    offerName: index === 3 ? "Lista USD 11800 · Contado especial USD 10000" : "Círculo Millonario",
    producto: "Círculo Millonario",
    estadoAgenda: "ACUERDO SIN PAGO",
    ventaTotal: 10000,
    cashCollected: 0,
    recordedAt: new Date(`2026-09-${27 + index}T12:00:00.000Z`),
  }));
  calls.push({
    offerName: "Quedamos en que el viernes",
    producto: "",
    estadoAgenda: "SHOW",
    ventaTotal: 2026,
    cashCollected: 0,
    recordedAt: PASTE_AT,
  });
  const rolled = rollupCalls(offers, calls);
  assert.equal(rolled.ventas, 40000);
  assert.equal(rolled.cash, 0);
  assert.equal(rolled.porOferta.length, 1);
  assert.equal(rolled.porOferta[0]?.oferta, "Círculo Millonario");
  assert.equal(rolled.porOferta[0]?.ventas, 40000);
  assert.equal(
    rolled.porOferta.reduce((sum, row) => sum + row.ventas, 0),
    rolled.ventas,
  );
  assert.equal(
    rolled.porOferta.reduce((sum, row) => sum + row.cash, 0),
    rolled.cash,
  );

  const october = rollupCalls(offers, calls, zonedMonthRange(PASTE_AT));
  assert.equal(october.ventas, 0);
  const september = rollupCalls(offers, calls, zonedMonthRange(new Date("2026-09-15T17:00:00.000Z")));
  assert.equal(september.ventas, 40000);
});
