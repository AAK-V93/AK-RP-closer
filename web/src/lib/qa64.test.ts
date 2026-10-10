import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { buildPersonFacts, nextLine, NO_FOLLOWUP_DATE, type FactCall } from "./person-facts";
import { factsForModel } from "./crm-chat";
import { operacionFromCall } from "./crm-operacion";
import { commissionSummaryLine } from "./deal-money";
import { attributeOffers, buildCoachOffers, NO_OFFER_LABEL, type CoachEvidence } from "./coach-offers";
import { isNewerBuild, shouldCheckVersion } from "./app-version";

const NOW = new Date("2026-10-09T15:00:00Z");
const usd = (n: number) => `USD ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const CARLOS = "cmupoj6w50004i904csdnras3";

/* ---------- 1. Carlos Ramírez: row, ficha and chat from one rule ---------- */

// The two copies of the 30 sep call, as stored (trimmed to the fields that matter).
const firstCopy: FactCall = {
  id: "cmupoj6u30002i904dfpo7j8g",
  leadName: "Carlos Ramírez",
  estadoAgenda: "SHOW",
  recordedAt: "2026-09-30T17:00:00.000Z",
  createdAt: "2026-10-01T20:19:00.699Z",
  filingJson: {
    lead_id: CARLOS,
    producto: "Círculo Millonario",
    acuerdo_seguimiento: "Llamar el viernes para cerrar tras hablarlo con la socia.",
    proximo_seguimiento: "2026-10-02 10:00",
    tipo_seguimiento: "DECISION",
    razon_no_cierre: "Necesita consultarlo con alguien",
    seguimiento_resultado: null,
  },
};
const laterCopy: FactCall = {
  id: "cmur8ke0z0002if04d0gqia7p",
  leadName: "Carlos Ramírez",
  estadoAgenda: "SHOW",
  recordedAt: "2026-09-30T17:00:00.000Z",
  createdAt: "2026-10-02T22:27:35.171Z",
  filingJson: {
    lead_id: CARLOS,
    producto: "Círculo Millonario",
    acuerdo_seguimiento: "Llamar el viernes 2 de octubre para cerrar después de hablar con su socia.",
    proximo_seguimiento: "",
    seguimiento_cerrado: "2026-10-03 10:00",
    seguimiento_intentos: 2,
    seguimiento_resultado: "hecho",
    tipo_seguimiento: "SEGUNDA REUNION",
    razon_no_cierre: "Necesita consultarlo con alguien",
  },
};
const carlosLead = {
  id: CARLOS,
  name: "Carlos Ramírez",
  status: "seguimiento",
  offerName: "Círculo Millonario",
  nextStep: "Llamar el viernes para cerrar tras hablarlo con la socia.",
  nextStepAt: "2026-10-02T15:00:00.000Z",
};

test("Carlos: the later copy («Hecho», no new date) wins, in any order → «Sin fecha de seguimiento» everywhere", () => {
  for (const calls of [[firstCopy, laterCopy], [laterCopy, firstCopy]]) {
    const facts = buildPersonFacts({ lead: carlosLead, calls, now: NOW });
    assert.equal(facts.status, "En seguimiento");
    assert.equal(facts.followupClosed, true);
    assert.equal(facts.nextDay, "", "the lead's old nextStepAt (2 oct) does not come back");
    assert.equal(facts.callId, laterCopy.id);
    // Ficha
    assert.equal(nextLine(facts, NOW), NO_FOLLOWUP_DATE);
    assert.doesNotMatch(facts.summary.text, /2 de octubre|viernes|Pendiente/);
    assert.equal(facts.summary.text, "Ya hiciste el seguimiento que acordaron. No quedó otra fecha.");
    // Chat
    const model = factsForModel(facts, NOW);
    assert.equal(model.proximo, NO_FOLLOWUP_DATE);
    assert.ok(!model.acuerdo);
    assert.doesNotMatch(model.resumen, /viernes|2 de octubre/);
  }
  // CRM row: the same «closed» rule on the same call.
  const row = operacionFromCall({ ...laterCopy, title: "Carlos Ramírez · 30/9/2026", filingStatus: "confirmed" } as never);
  assert.equal(row.seguimientoCerrado, true);
});

test("a later copy that still has a date keeps it pending (no false «Sin fecha»)", () => {
  const facts = buildPersonFacts({ lead: carlosLead, calls: [{ ...firstCopy, createdAt: "2026-10-03T00:00:00Z" }, laterCopy], now: NOW });
  assert.equal(facts.followupClosed, false);
  assert.equal(facts.nextDay, "2026-10-02");
  assert.match(nextLine(facts, NOW), /^Pendiente desde el 2 oct/);
});

test("an open alert after «Hecho» is the next date", () => {
  const facts = buildPersonFacts({
    lead: carlosLead,
    calls: [firstCopy, laterCopy],
    alerts: [{ id: "al", type: "SEGUIMIENTO", dueAt: "2026-10-12T15:00:00Z", resolvedAt: null }],
    now: NOW,
  });
  assert.equal(facts.followupClosed, false);
  assert.equal(facts.nextDay, "2026-10-12");
});

/* ---------- 2. Comisiones: the commission line never reads as the sale money ---------- */

test("the commission line says «Tu comisión» and is hidden when there is no commission", () => {
  assert.equal(commissionSummaryLine({ generada: 0, cobrada: 0, pendiente: 0, pctCobrado: 0 }, usd), "");
  assert.equal(commissionSummaryLine(null, usd), "");
  assert.equal(
    commissionSummaryLine({ generada: 300, cobrada: 100, pendiente: 200, pctCobrado: 1 / 3 }, usd),
    "Tu comisión: USD 300 generada · USD 100 cobrada · USD 200 por cobrar (33% cobrado).",
  );
  const page = readFileSync(new URL("../app/crm/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /Generada \{money\(resumen\.generada\)\}/);
  assert.match(page, /commissionSummaryLine\(resumen/);
  assert.match(page, /label: "Comisión"/);
});

/* ---------- 3. Coach: offer of lost people ---------- */

test("a person's offer comes from their other call or lead when it's the only one", () => {
  const rows: CoachEvidence[] = [
    { id: "c1", cliente: "Maria Leydis Palacios Murillo", fecha: "2026-09-30", estadoAgenda: "SHOW", oferta: "Círculo Millonario" },
    { id: "lead:Maria Leydis Palacios Murillo", cliente: "Maria Leydis Palacios Murillo", oferta: "", razonNoCierre: "Otro" },
    { id: "c2", cliente: "Ana Doble", oferta: "Círculo Millonario" },
    { id: "c3", cliente: "Ana Doble", oferta: "Fertilidad Consciente" },
    { id: "c4", cliente: "Ana Doble", oferta: "" },
    { id: "c5", cliente: "Karen Dalia Chirinos Mendoza", oferta: "", producto: "OTROS" },
  ];
  const out = attributeOffers(rows);
  assert.equal(out[1].oferta, "Círculo Millonario");
  assert.equal(out[4].oferta, "", "two different offers: nothing guessed");
  assert.equal(out[5].oferta, "", "no offer anywhere: stays without one");
});

test("lost people with no offer anywhere sit in «Sin oferta anotada»; offers say «0 perdidos anotados», not «sin datos»", () => {
  const NOW_OCT = new Date("2026-10-09T15:00:00Z");
  const calls: CoachEvidence[] = [
    { id: "a", cliente: "Valeria Ríos", fecha: "2026-10-01", estadoAgenda: "CIERRE VENTA", oferta: "Fertilidad Consciente" },
    { id: "b", cliente: "Lucía Torres", fecha: "2026-09-29", estadoAgenda: "SHOW", oferta: "Círculo Millonario", fechaProximo: "2026-10-12" },
    { id: "k", cliente: "Karen Dalia Chirinos Mendoza", fecha: "2026-09-17", estadoAgenda: "SHOW", producto: "OTROS", razonNoCierre: "Necesita consultarlo con alguien" },
    { id: "r", cliente: "Ramón Márquez", fecha: "2026-09-17", estadoAgenda: "SHOW", producto: "OTROS", razonNoCierre: "No confía / Necesita más información" },
    // Lost on the lead, offer only on the call → goes to Círculo.
    { id: "m", cliente: "Maria Leydis Palacios Murillo", fecha: "2026-09-30", estadoAgenda: "SHOW", oferta: "Círculo Millonario" },
    { id: "lead:Maria Leydis Palacios Murillo", cliente: "Maria Leydis Palacios Murillo", leadStatus: "perdido", oferta: "" },
  ];
  const board = buildCoachOffers({ calls, offerNames: ["Círculo Millonario", "Fertilidad Consciente"], now: NOW_OCT });
  const byName = Object.fromEntries(board.offers.map((card) => [card.offerName, card]));
  assert.ok(byName[NO_OFFER_LABEL]);
  assert.ok(!byName["Sin oferta"]);
  const texts = board.offers.flatMap((card) => [card.monthVersus, card.historyVersus]).join(" | ");
  assert.doesNotMatch(texts, /perdidos sin datos/);
  assert.match(byName["Círculo Millonario"].historyVersus || byName["Círculo Millonario"].monthVersus, /1 perdido/);
  assert.match(byName[NO_OFFER_LABEL].historyVersus || byName[NO_OFFER_LABEL].monthVersus, /2 perdidos/);
  assert.match(byName["Fertilidad Consciente"].historyVersus || byName["Fertilidad Consciente"].monthVersus, /0 perdidos anotados/);
});

/* ---------- 4. New version notice ---------- */

test("the new-version check is cheap and never nags in dev", () => {
  assert.equal(isNewerBuild("dpl_a", "dpl_b"), true);
  assert.equal(isNewerBuild("dpl_a", "dpl_a"), false);
  assert.equal(isNewerBuild("", "dpl_b"), false);
  assert.equal(isNewerBuild("local-1", "local-2"), false);
  assert.equal(isNewerBuild("dpl_a", undefined), false);
  assert.equal(shouldCheckVersion(0, 30_000), false);
  assert.equal(shouldCheckVersion(0, 60_000), true);
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /<VersionNotice \/>/);
  const notice = readFileSync(new URL("../components/version-notice.tsx", import.meta.url), "utf8");
  assert.match(notice, /role="status"/);
  assert.match(notice, /cache: "no-store"/);
});
