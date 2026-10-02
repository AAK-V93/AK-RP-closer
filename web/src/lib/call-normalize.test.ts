import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  canonicalProducto,
  canonicalTipo,
  normalizeImportedFiling,
  normalizeProximo,
  planCallRepair,
  repairImportedCallFields,
  shouldDropInferredSale,
  type CallRepairInput,
} from "./call-normalize";

const PRICE = "Lista USD 11800 · Contado especial USD 10000";

function alejandro(overrides: Partial<CallRepairInput> = {}): CallRepairInput {
  return {
    id: "alejandro-meet",
    offerName: PRICE,
    estadoAgenda: "SHOW",
    ventaTotal: 10000,
    saldoPendiente: 10000,
    cashCollected: null,
    filingJson: {
      producto: PRICE,
      tipo_seguimiento: "Sí",
      proximo_seguimiento: "2026-10-08 00:47",
      estado_agenda: "SHOW",
      venta_total: 10000,
      saldo_pendiente: 10000,
      acuerdo_seguimiento: "",
      notas_crm: "Impromptu Google Meet Meeting",
    },
    ...overrides,
  };
}

test("a field repair keeps the lead id and the lost reason while dropping an inferred show amount", () => {
  const source = alejandro();
  const filing = source.filingJson as Record<string, unknown>;
  const repair = planCallRepair(
    {
      ...source,
      filingJson: { ...filing, lead_id: "lead-carlos", razon_no_cierre: "Precio" },
    },
    ["Círculo Millonario"],
  );
  assert.ok(repair);
  assert.equal(repair.ventaTotal, null);
  assert.equal(repair.filingJson.lead_id, "lead-carlos");
  assert.equal(repair.filingJson.razon_no_cierre, "Precio");
});

test("an interrupted Meet import is repaired to catalog fields", () => {
  const repair = planCallRepair(alejandro(), ["Círculo Millonario"]);
  assert.ok(repair);
  assert.equal(repair.offerName, "");
  assert.equal(repair.ventaTotal, null);
  assert.equal(repair.saldoPendiente, null);
  assert.equal(repair.filingJson.producto, null);
  assert.equal(repair.filingJson.tipo_seguimiento, null);
  assert.equal(repair.filingJson.proximo_seguimiento, "2026-10-08");
  assert.equal(repair.filingJson.venta_total, null);
});

test("a price sentence stays empty when several real offers exist", () => {
  const repair = planCallRepair(alejandro(), ["Círculo Millonario", "Mentoría"]);
  assert.ok(repair);
  assert.equal(repair.offerName, "");
  assert.equal(repair.filingJson.producto, null);
  assert.notEqual(repair.filingJson.producto, PRICE);
});

test("an agreed close keeps the sale and a real wall clock", () => {
  const closed = alejandro({
    offerName: "Círculo Millonario",
    estadoAgenda: "CIERRE VENTA",
    ventaTotal: 10000,
    saldoPendiente: 7000,
    filingJson: {
      producto: "Círculo Millonario",
      tipo_seguimiento: "PAGO PENDIENTE",
      proximo_seguimiento: "2026-10-08 17:00",
      estado_agenda: "CIERRE VENTA",
      venta_total: 10000,
      saldo_pendiente: 7000,
      acuerdo_seguimiento: "Quedó en 10000 USD",
    },
  });
  assert.equal(planCallRepair(closed, ["Círculo Millonario"]), null);
  assert.equal(
    shouldDropInferredSale({
      venta_total: 10000,
      cash_collected: null,
      estado_agenda: "CIERRE VENTA",
      acuerdo_seguimiento: "Quedó en 10000 USD",
    }),
    false,
  );
});

test("a spoken time replaces 00:47 and a bare 17:00 stays", () => {
  const spoken = alejandro({
    offerName: "Círculo Millonario",
    ventaTotal: null,
    saldoPendiente: null,
    filingJson: {
      producto: "Círculo Millonario",
      tipo_seguimiento: "DECISION",
      proximo_seguimiento: "2026-10-08 00:47",
      acuerdo_seguimiento: "seguimos el 8 de octubre a las 5 pm",
      notas_crm: "Impromptu Google Meet Meeting",
    },
  });
  const repair = planCallRepair(spoken, ["Círculo Millonario"]);
  assert.equal(repair?.filingJson.proximo_seguimiento, "2026-10-08 17:00");
  assert.equal(normalizeProximo("2026-10-08 17:00", "sin hora dicha"), "2026-10-08 17:00");
  assert.equal(normalizeProximo("2026-10-08T05:47:00.000Z", ""), "2026-10-08");
});

test("new imports drop Sí, a price label, an inferred sale and a stamp clock", () => {
  const parsed = normalizeImportedFiling(
    {
      producto: PRICE,
      tipo_seguimiento: "Sí",
      proximo_seguimiento: "2026-10-08 00:47",
      venta_total: 10000,
      saldo_pendiente: 10000,
      cash_collected: null,
      estado_agenda: "SHOW",
      acuerdo_seguimiento: "",
      notas_crm: "Impromptu Google Meet Meeting",
      evidencia: { seguimiento: "[00:47:12] se cortó" },
    },
    "Impromptu Google Meet Meeting. Lista USD 11800. La llamada se cortó.",
  );
  assert.equal(parsed.tipo_seguimiento, null);
  assert.equal(parsed.producto, null);
  assert.equal(parsed.venta_total, null);
  assert.equal(parsed.proximo_seguimiento, "2026-10-08");
  assert.equal(canonicalTipo("DECISION"), "DECISION");
  assert.equal(canonicalTipo("sí"), "");
  assert.equal(canonicalProducto("MENTORIAS", ["Círculo Millonario"]), "MENTORIAS");
});

test("a repaired próximo is stable, so the next dashboard load does not write it again", () => {
  const offers = ["Círculo Millonario"];
  const first = planCallRepair(
    alejandro({
      offerName: "Círculo Millonario",
      ventaTotal: null,
      saldoPendiente: null,
      filingJson: {
        producto: "Círculo Millonario",
        tipo_seguimiento: "DECISION",
        proximo_seguimiento: "2026-10-08T17:00:00.000Z",
        acuerdo_seguimiento: "seguimos el 8 de octubre a las 5 pm",
        notas_crm: "quedó para las 5",
        evidencia: { seguimiento: "a las 5 pm, no es un sello de transcripción" },
      },
    }),
    offers,
  );
  assert.ok(first);
  const stored = {
    ...alejandro({
      offerName: first.offerName,
      ventaTotal: first.ventaTotal,
      saldoPendiente: first.saldoPendiente,
      filingJson: first.filingJson,
    }),
  };
  assert.equal(planCallRepair(stored, offers), null);
  const long = planCallRepair(
    alejandro({
      offerName: "Círculo Millonario",
      ventaTotal: null,
      saldoPendiente: null,
      filingJson: {
        producto: "Círculo Millonario",
        tipo_seguimiento: "DECISION",
        proximo_seguimiento: "2026-10-08 17:00:00.000",
        acuerdo_seguimiento: "",
        notas_crm: "",
      },
    }),
    offers,
  );
  assert.equal(long?.filingJson.proximo_seguimiento, "2026-10-08 17:00");
  assert.equal(
    planCallRepair(
      alejandro({
        offerName: "Círculo Millonario",
        ventaTotal: null,
        saldoPendiente: null,
        filingJson: { ...long!.filingJson },
      }),
      offers,
    ),
    null,
  );
});

test("repair writes one row at a time and skips a clean row", async () => {
  const updates: string[] = [];
  const dirty = alejandro();
  const clean: CallRepairInput = {
    id: "clean",
    offerName: "Círculo Millonario",
    estadoAgenda: "SHOW",
    ventaTotal: null,
    filingJson: {
      producto: "Círculo Millonario",
      tipo_seguimiento: "DECISION",
      proximo_seguimiento: "2026-10-08",
    },
  };
  const prisma = {
    callRecord: {
      update: async ({ where }: { where: { id: string } }) => {
        updates.push(where.id);
      },
      updateMany: async () => {
        updates.push("updateMany");
      },
    },
  };
  await repairImportedCallFields(prisma as unknown as PrismaClient, ["Círculo Millonario"], [
    [dirty, clean],
    [dirty],
  ]);
  assert.deepEqual(updates, ["alejandro-meet"]);
  assert.equal(dirty.offerName, "");
  assert.equal(dirty.ventaTotal, null);
  assert.equal(clean.offerName, "Círculo Millonario");
});
