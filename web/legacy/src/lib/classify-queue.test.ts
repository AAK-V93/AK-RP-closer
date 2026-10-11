import assert from "node:assert/strict";
import { test } from "node:test";
import { classifiablePending } from "./classify-queue";
import { analyzeCardStatus } from "./home-desk";
import type { CrmLeadRef } from "./lead-match";

const leads: CrmLeadRef[] = [
  { id: "qa6", name: "Valeria Ríos QA6", company: "", telefono: "", email: "", callIds: ["call-qa6"] },
  { id: "edson", name: "Edson", company: "", telefono: "", email: "", callIds: [] },
];

test("Inicio and the Llamadas card count the same 8 classifiable calls", () => {
  const open = Array.from({ length: 8 }, (_, index) => ({
    id: `open-${index + 1}`,
    leadName: `Cliente suelto ${index + 1}`,
    title: `Llamada ${index + 1}`,
    summary: "sin lead",
    estadoAgenda: "SHOW",
    filingJson: {},
  }));
  const internas = [
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `interna-${index + 1}`,
      leadName: "",
      title: `Coaching interno ${index + 1}`,
      summary: "",
      estadoAgenda: "INTERNA",
      filingJson: {},
    })),
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `coaching-${index + 1}`,
      leadName: "Equipo",
      title: "Coaching interno",
      summary: "",
      estadoAgenda: "",
      filingJson: { estado_agenda: "INTERNA" },
    })),
  ];
  const crm = [
    {
      id: "call-qa6",
      leadName: "Valeria Ríos QA6",
      title: "Valeria Ríos QA6",
      summary: "cuota",
      estadoAgenda: "CIERRE VENTA",
      filingJson: { cliente_real: "Valeria Ríos QA6" },
    },
    {
      id: "call-edson",
      leadName: "Edson",
      title: "Edson",
      summary: "llamada",
      estadoAgenda: "SHOW",
      filingJson: { lead_id: "edson", cliente_real: "Edson" },
    },
  ];
  const pending = [...open, ...internas, ...crm];
  assert.equal(pending.length, 24);
  const queue = classifiablePending(pending, leads);
  assert.equal(queue.length, 8);
  assert.deepEqual(
    queue.map((row) => row.id),
    open.map((row) => row.id),
  );
  const card = analyzeCardStatus(queue.length);
  const home = analyzeCardStatus(queue.length);
  assert.equal(card, "8 sin clasificar");
  assert.equal(home, card);
  assert.notEqual(analyzeCardStatus(pending.length), card);
});
