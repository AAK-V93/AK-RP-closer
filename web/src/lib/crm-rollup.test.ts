import assert from "node:assert/strict";
import { test } from "node:test";
import { explainVentas, mentionedPriceOnly, rollupCalls } from "./crm-rollup";
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
  assert.equal(rolled.ventas, 0);
  assert.equal(rolled.cierres, 0);
  assert.equal(rolled.cash, 0);
  assert.equal(rolled.porOferta.length, 1);
  assert.equal(rolled.porOferta[0]?.oferta, "Círculo Millonario");
  assert.equal(rolled.porOferta[0]?.ventas, 0);
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
  assert.equal(september.ventas, 0);
  assert.equal(september.cierres, 0);
});

test("a show with an amount is not a venta; a cierre with an amount is", () => {
  const offers = [{ productName: "Círculo Millonario", prices: [11800, 10000], aliases: [] }];
  const shows = ["Carlos", "Andrea", "Diego", "Sofía"].map((cliente, index) => ({
    id: `show-${index}`,
    cliente,
    offerName: "Círculo Millonario",
    estadoAgenda: "SHOW",
    ventaTotal: 10000,
    cashCollected: index === 0 ? 2000 : 0,
    recordedAt: new Date(`2026-09-${26 + index}T17:00:00.000Z`),
  }));
  const edson = {
    id: "edson",
    cliente: "Edson",
    offerName: "Círculo Millonario",
    estadoAgenda: "CIERRE VENTA",
    ventaTotal: null,
    cashCollected: 0,
    recordedAt: new Date("2026-09-20T17:00:00.000Z"),
  };
  const closed = {
    id: "closed",
    cliente: "Lucía",
    offerName: "Círculo Millonario",
    estadoAgenda: "CIERRE VENTA",
    ventaTotal: 10000,
    cashCollected: 0,
    recordedAt: new Date("2026-09-21T17:00:00.000Z"),
  };
  const rolled = rollupCalls(offers, [...shows, edson, closed]);
  const explained = explainVentas([...shows, edson, closed], [11800, 10000]);
  assert.equal(rolled.ventas, 10000);
  assert.equal(rolled.cierres, 1);
  assert.equal(rolled.cash, 2000);
  assert.equal(rolled.porOferta[0]?.ventas, 10000);
  assert.equal(rolled.porOferta[0]?.cierres, 1);
  assert.equal(explained.n, 1);
  assert.equal(explained.total, rolled.ventas);
  assert.equal(explained.leads[0]?.cliente, "Lucía");
  const september = rollupCalls(offers, [...shows, edson, closed], zonedMonthRange(new Date("2026-09-15T17:00:00.000Z")));
  assert.equal(september.cierres, 1);
  assert.equal(september.ventas, 10000);
  assert.equal(september.cash, 2000);
});

test("two rows for Carlos count once, and Alejandro's mentioned price does not", () => {
  const offers = [{ productName: "Círculo Millonario", prices: [11800, 10000], aliases: [] }];
  const decision = {
    id: "carlos-decision",
    cliente: "Carlos Ramírez",
    leadId: "lead-carlos",
    offerName: "Círculo Millonario",
    estadoAgenda: "CIERRE VENTA",
    ventaTotal: 10000,
    cashCollected: 2000,
    acuerdo: "Quedó en 10000 USD",
    recordedAt: new Date("2026-09-28T17:00:00.000Z"),
  };
  const duplicate = {
    id: "carlos-segunda",
    cliente: "Carlos Ramírez (QA)",
    leadId: "lead-copy",
    offerName: "Círculo Millonario",
    estadoAgenda: "CIERRE VENTA",
    tipoSeguimiento: "SEGUNDA REUNION",
    ventaTotal: 10000,
    cashCollected: 0,
    acuerdo: "",
    notas: "Llamar el viernes 3 de octubre",
    recordedAt: new Date("2026-09-30T17:00:00.000Z"),
  };
  const duplicateAgreed = {
    ...duplicate,
    acuerdo: "Quedó en 10000 USD",
  };
  const alejandro = {
    id: "alejandro-meet",
    cliente: "Alejandro",
    offerName: "Lista USD 11800 · Contado especial USD 10000",
    producto: "Lista USD 11800 · Contado especial USD 10000",
    estadoAgenda: "SHOW",
    ventaTotal: 10000,
    cashCollected: 0,
    notas: "Impromptu Google Meet Meeting",
    recordedAt: new Date("2026-09-29T17:00:00.000Z"),
  };
  assert.equal(mentionedPriceOnly(alejandro), true);
  assert.equal(mentionedPriceOnly(duplicate), true);

  const pending = rollupCalls(offers, [decision, duplicate, alejandro]);
  const pendingList = explainVentas([decision, duplicate, alejandro], [11800, 10000]);
  assert.equal(pending.ventas, 10000);
  assert.equal(pending.cierres, 1);
  assert.equal(pending.cash, 2000);
  assert.equal(pending.porOferta[0]?.oferta, "Círculo Millonario");
  assert.equal(pending.porOferta[0]?.cierres, 1);
  assert.equal(pending.porOferta[0]?.ventas, 10000);
  assert.equal(pending.porOferta[0]?.cash, 2000);
  assert.equal(pendingList.n, 1);
  assert.equal(pendingList.total, pending.ventas);
  assert.equal(pendingList.leads[0]?.cliente, "Carlos Ramírez");
  assert.equal(pendingList.leads[0]?.id, "carlos-decision");

  const doubled = rollupCalls(offers, [decision, duplicateAgreed, alejandro]);
  const doubledList = explainVentas([decision, duplicateAgreed, alejandro], [11800, 10000]);
  assert.equal(doubled.ventas, 10000);
  assert.equal(doubled.cierres, 1);
  assert.equal(doubledList.n, 1);
  assert.equal(doubledList.total, 10000);
  assert.equal(doubledList.leads[0]?.id, "carlos-segunda");
  assert.equal(doubledList.leads[0]?.cliente, "Carlos Ramírez");
});
