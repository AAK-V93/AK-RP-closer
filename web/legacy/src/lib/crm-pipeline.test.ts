import assert from "node:assert/strict";
import test from "node:test";
import {
  dineroEnJuegoNote,
  expectedDealValue,
  isActiveOpenStage,
  openPipeline,
  pipelineDetailGroups,
  saldoPorCobrar,
  sinPrecioNote,
  summarizePipeline,
} from "./crm-pipeline";

test("an open lead uses its own price, then list, then cash", () => {
  assert.equal(expectedDealValue({ price: 8000, listPrice: 10000, cashPrice: 9000 }), 8000);
  assert.equal(expectedDealValue({ price: null, listPrice: 10000, cashPrice: 9000 }), 10000);
  assert.equal(expectedDealValue({ price: null, listPrice: null, cashPrice: 9000 }), 9000);
  assert.equal(
    expectedDealValue({ price: 2026, listPrice: 10000, at: "2026-10-02T15:00:00.000Z" }),
    10000,
  );
});

test("dinero en juego sums each open person once and skips Cerró and Perdido", () => {
  const open = Array.from({ length: 23 }, (_, index) => ({
    person: `Lead ${index + 1}`,
    stage: index % 2 === 0 ? "DECISION" : "RETOMAR",
    listPrice: 10_000,
  }));
  const out = openPipeline([
    ...open,
    { person: "Edson", closed: true, stage: "DECISION", price: 10_000, listPrice: 10_000 },
    { person: "Nadie", lost: true, stage: "RETOMAR", listPrice: 10_000 },
    { person: "Sin etapa", listPrice: 10_000 },
    { person: "Carlos Ramírez", nextFollowup: true, price: 8000, listPrice: 10_000 },
    { person: "Carlos Ramírez (QA)", nextFollowup: true, price: 8000, listPrice: 10_000 },
    { person: "Sofía Mamani", nextFollowup: true, cashPrice: 9000 },
    { person: "Solo lista", stage: "SEGUNDA_REUNION", listPrice: 10_000 },
  ]);
  assert.equal(out.total, 23 * 10_000 + 8000 + 9000 + 10_000);
  assert.equal(out.count, 26);
  assert.equal(isActiveOpenStage("DECISION"), true);
  assert.equal(isActiveOpenStage("CIERRE VENTA"), false);
  assert.match(dineroEnJuegoNote(out.count), /26 leads/);
  assert.match(dineroEnJuegoNote(1), /1 lead/);
});

test("saldo por cobrar is the closed sale minus Cobrado, once per person", () => {
  assert.equal(
    saldoPorCobrar([
      { person: "Edson", closed: true, sale: 10_000, collected: 2000 },
      { person: "Edson (QA)", closed: true, sale: 10_000, collected: 2000 },
      { person: "Ana", closed: false, sale: 10_000, collected: 0 },
      { person: "Pago", closed: true, sale: 10_000, collected: 10_000 },
      { person: "Sin monto", closed: true, sale: null, collected: 0 },
    ]),
    8000,
  );
});

test("decision leads with only the offer price are the open pipeline", () => {
  const offers = [
    {
      productName: "Círculo Millonario",
      listPrice: 10_000,
      altPrices: [{ label: "Contado", amount: 9000 }],
    },
  ];
  const leads = [
    {
      id: "ana",
      name: "Ana Pérez",
      status: "seguimiento",
      offerName: "Círculo Millonario",
      amountTalked: "",
    },
    {
      id: "luis",
      name: "Luis Gómez",
      status: "seguimiento",
      offerName: "Círculo Millonario",
      amountTalked: "7000",
    },
    {
      id: "edson",
      name: "Edson",
      status: "cerrado",
      offerName: "Círculo Millonario",
      amountTalked: "",
    },
    {
      id: "perdido",
      name: "Mario",
      status: "perdido",
      offerName: "Círculo Millonario",
      amountTalked: "",
    },
  ];
  const out = summarizePipeline({
    leads,
    offers,
    threads: [
      { leadId: "ana", tipo: "DECISION", estado: "activo" },
      { leadId: "luis", tipo: "RETOMAR", estado: "activo" },
      { leadId: "perdido", tipo: "RETOMAR", estado: "activo" },
    ],
    calls: [
      {
        leadName: "Ana Pérez",
        offerName: "Círculo Millonario",
        estadoAgenda: "SHOW",
        ventaTotal: null,
        cashCollected: 0,
        recordedAt: "2026-09-20T15:00:00.000Z",
      },
      {
        leadName: "Luis Gómez",
        offerName: "Círculo Millonario",
        estadoAgenda: "SHOW",
        ventaTotal: null,
        cashCollected: 0,
        recordedAt: "2026-09-21T15:00:00.000Z",
      },
      {
        leadName: "Edson",
        offerName: "Círculo Millonario",
        estadoAgenda: "CIERRE VENTA",
        ventaTotal: 10_000,
        cashCollected: 2000,
        recordedAt: "2026-09-22T15:00:00.000Z",
      },
      {
        leadName: "Mario",
        offerName: "Círculo Millonario",
        estadoAgenda: "SHOW",
        ventaTotal: 10_000,
        cashCollected: 0,
      },
    ],
  });
  assert.equal(out.pipeline.total, 17_000);
  assert.equal(out.pipeline.count, 2);
  assert.equal(out.saldo, 8000);
});

test("a lead with no offer does not inherit the only catalog list price", () => {
  const offers = [
    {
      productName: "Círculo Millonario",
      listPrice: 11_800,
      altPrices: [{ label: "Contado", amount: 10_000 }],
    },
  ];
  const leads = [
    ...Array.from({ length: 19 }, (_, index) => ({
      id: `sin-${index}`,
      name: `Lead ${index + 1}`,
      status: "seguimiento",
      offerName: "",
      amountTalked: "",
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `precio-${index}`,
      name: `Precio ${index + 1}`,
      status: "seguimiento",
      offerName: "",
      amountTalked: "10000",
    })),
  ];
  const out = summarizePipeline({
    leads,
    offers,
    threads: leads.map((lead) => ({ leadId: lead.id, tipo: "DECISION", estado: "activo" })),
    calls: [],
  });
  assert.equal(out.pipeline.count, 23);
  assert.equal(out.pipeline.total, 40_000);
  const onOffer = summarizePipeline({
    leads: [
      {
        id: "ana",
        name: "Ana Pérez",
        status: "seguimiento",
        offerName: "Círculo Millonario",
        amountTalked: "",
      },
    ],
    offers,
    threads: [{ leadId: "ana", tipo: "DECISION", estado: "activo" }],
    calls: [],
  });
  assert.equal(onOffer.pipeline.total, 11_800);
  const twoOffers = summarizePipeline({
    leads: [
      {
        id: "ana",
        name: "Ana Pérez",
        status: "seguimiento",
        offerName: "Círculo Millonario",
        amountTalked: "",
      },
    ],
    offers: [
      ...offers,
      { productName: "Otra", listPrice: 50_000, altPrices: [] },
    ],
    threads: [{ leadId: "ana", tipo: "DECISION", estado: "activo" }],
    calls: [
      {
        leadName: "Ana Pérez",
        offerName: "Círculo Millonario",
        ventaTotal: 11_800,
        recordedAt: "2026-10-02T15:00:00.000Z",
      },
      {
        leadName: "Ana Pérez",
        offerName: "Otra",
        ventaTotal: 50_000,
        recordedAt: "2026-09-01T15:00:00.000Z",
      },
    ],
  });
  assert.equal(twoOffers.pipeline.count, 1);
  assert.equal(twoOffers.pipeline.total, 11_800);
});

test("a catalog price on the call is not the lead's offer", () => {
  const offers = [
    {
      productName: "Círculo Millonario",
      listPrice: 11_800,
      altPrices: [{ label: "Contado", amount: 10_000 }],
    },
  ];
  const fromCalls = Array.from({ length: 13 }, (_, index) => ({
    id: `call-${index}`,
    name: `Llamada ${index + 1}`,
    status: "seguimiento",
    offerName: "",
    amountTalked: "",
  }));
  const talked = Array.from({ length: 4 }, (_, index) => ({
    id: `precio-${index}`,
    name: `Precio ${index + 1}`,
    status: "seguimiento",
    offerName: "",
    amountTalked: "10000",
  }));
  const empty = Array.from({ length: 6 }, (_, index) => ({
    id: `cero-${index}`,
    name: `Cero ${index + 1}`,
    status: "seguimiento",
    offerName: "",
    amountTalked: "",
  }));
  const leads = [...fromCalls, ...talked, ...empty];
  const out = summarizePipeline({
    leads,
    offers,
    threads: leads.map((lead) => ({ leadId: lead.id, tipo: "DECISION", estado: "activo" })),
    calls: fromCalls.map((lead) => ({
      leadName: lead.name,
      offerName: "Círculo Millonario",
      estadoAgenda: "SHOW",
      ventaTotal: null,
      filingJson: { producto: "Lista USD 11800 · Contado especial USD 10000" },
    })),
  });
  assert.equal(out.pipeline.count, 23);
  assert.equal(out.pipeline.total, 40_000);
  assert.equal(
    out.lines.reduce((sum, row) => sum + row.amount, 0),
    out.pipeline.total,
  );
  assert.equal(out.lines.filter((row) => row.fuente === "precio hablado").length, 4);
  assert.equal(out.lines.filter((row) => row.fuente === "sin precio").length, 19);
  assert.equal(sinPrecioNote(19), "19 sin precio");
  assert.ok(out.lines[0]!.amount >= out.lines[out.lines.length - 1]!.amount);

  const attached = summarizePipeline({
    leads: [
      {
        id: "ana",
        name: "Ana Pérez",
        status: "seguimiento",
        offerName: "Círculo Millonario",
        amountTalked: "",
      },
    ],
    offers,
    threads: [{ leadId: "ana", tipo: "DECISION", estado: "activo" }],
    calls: [],
  });
  assert.equal(attached.pipeline.total, 11_800);
  assert.equal(attached.lines[0]?.fuente, "precio de lista de Círculo Millonario");

  const cashOnly = summarizePipeline({
    leads: [
      {
        id: "luz",
        name: "Luz Vega",
        status: "seguimiento",
        offerName: "Círculo Millonario",
        amountTalked: "",
      },
    ],
    offers: [{ productName: "Círculo Millonario", listPrice: null, altPrices: [{ label: "Contado", amount: 10_000 }] }],
    threads: [{ leadId: "luz", tipo: "DECISION", estado: "activo" }],
    calls: [{ leadName: "Luz Vega", ventaTotal: 8_000, estadoAgenda: "SHOW" }],
  });
  assert.equal(cashOnly.pipeline.total, 8_000);
  assert.equal(cashOnly.lines[0]?.fuente, "venta de la última llamada");
});

test("detalle lists priced leads and keeps sin precio as one group", () => {
  const groups = pipelineDetailGroups([
    { name: "Carlos", amount: 11_800, fuente: "precio de lista de Círculo Millonario" },
    { name: "Lucía", amount: 11_800, fuente: "precio de lista de Círculo Millonario" },
    { name: "Ana", amount: 10_000, fuente: "precio hablado" },
    { name: "Sin uno", amount: 0, fuente: "sin precio" },
    { name: "Sin dos", amount: 0, fuente: "sin precio" },
  ]);
  assert.deepEqual(
    groups.priced.map((row) => row.name),
    ["Carlos", "Lucía", "Ana"],
  );
  assert.deepEqual(
    groups.unpriced.map((row) => row.name),
    ["Sin uno", "Sin dos"],
  );
  assert.equal(sinPrecioNote(groups.unpriced.length), "2 sin precio");
  assert.equal(
    groups.priced.reduce((sum, row) => sum + row.amount, 0) +
      groups.unpriced.reduce((sum, row) => sum + row.amount, 0),
    33_600,
  );
});
