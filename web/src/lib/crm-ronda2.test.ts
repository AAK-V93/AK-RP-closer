import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  buildPersonFacts,
  callNamesSomeoneElse,
  callsForPerson,
  personStage,
  personStatus,
  type FactCall,
} from "./person-facts";
import { agreementSummary, cleanNote, UNCLEAR_NEXT_STEP } from "./agreement-summary";
import { cobradoSinComision, dealMoney } from "./deal-money";
import { operacionFromCall } from "./crm-operacion";
import { buildCrmBoard, type CrmBoardFollowup } from "./crm-board";
import { seguimientoCounts, seguimientoLine } from "./inicio-view";
import { lostSuggestion, stageBucket, STAGE_BUCKETS, DEFAULT_FOLLOWUP_TARGET, suggestsLost } from "./followup-stage";
import { personMessages } from "./person-messages";
import { leadForCashCall } from "./crm-cash";
import { chatSuggestions } from "./crm-chat";
import { spanishDurations } from "./closer-spanish";
import { coachOffersBlock } from "./coach-grounding";
import { offerDescriptionPreview, transcriptListRows } from "./offer-transcripts";
import { QUEUE_PREVIEW } from "./llamadas-density";
import { cuotaAmountInNote } from "./crm-rollup";

const NOW = new Date("2026-10-09T15:00:00Z");
const usd = (n: number) => `USD ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

function call(partial: Partial<FactCall> & { id: string }): FactCall {
  return { recordedAt: "2026-09-20T15:00:00Z", ...partial };
}

/* ---------- A1: Perdido / Cerró have no stage, no «Le toca», no next step ---------- */

test("a Perdido has no stage, no next day and a summary that says it was lost and why", () => {
  const lead = { id: "L1", name: "Andrea Mero", status: "perdido", razonNoCierre: "Precio / No tiene dinero", nextStep: "Llamarla el lunes para cerrar." };
  const calls = [call({ id: "c1", leadName: "Andrea Mero", filingJson: { lead_id: "L1", acuerdo_seguimiento: "Llamarla el lunes para cerrar.", proximo_seguimiento: "2026-10-10" } })];
  const alerts = [{ id: "a1", dueAt: "2026-10-10T15:00:00Z", resolvedAt: null, resultado: null }];
  assert.equal(personStatus(lead, calls, alerts).status, "Perdido");
  assert.equal(personStage({ lead, calls, alerts }), null);
  const facts = buildPersonFacts({ lead, calls, alerts, now: NOW });
  assert.equal(facts.status, "Perdido");
  assert.equal(facts.ended, true);
  assert.equal(facts.stage, null);
  assert.equal(facts.nextDay, "");
  assert.equal(facts.summary.text, "Se perdió. Lo que frenó la venta fue el precio: dijo que no tenía el dinero.");
  assert.doesNotMatch(facts.summary.text, /lunes|cerrar/);
  assert.deepEqual(facts.messages, []);
});

test("a Cerró has no stage and the summary says what was paid and what is missing", () => {
  const lead = { id: "V1", name: "Valeria Ríos", status: "cerrado", amountPaid: "1066" };
  const calls = [
    call({
      id: "cmurfqupm0002jn04imwhgoos",
      leadName: "Valeria Ríos",
      estadoAgenda: "CIERRE VENTA",
      ventaTotal: 1597,
      cashCollected: 1066,
      saldoPendiente: 1064,
      filingJson: { lead_id: "V1", estado_agenda: "CIERRE VENTA", notas_crm: "Llamada de seguimiento para ver cómo arranca el programa." },
    }),
  ];
  const facts = buildPersonFacts({ lead, calls, now: NOW });
  assert.equal(facts.status, "Cerró");
  assert.equal(facts.stage, null);
  assert.equal(facts.nextDay, "");
  assert.match(facts.summary.text, /^Cerró\. Pagó USD 1\.066 de USD 1\.597; falta USD 531\./);
  assert.doesNotMatch(facts.summary.text, /Llamada de seguimiento para ver cómo arranca el programa/);
  // A fitting message for someone who already bought: no closing pitch.
  assert.ok(facts.messages.length > 0);
  for (const text of facts.messages) assert.doesNotMatch(text, /cerrar|propuesta|decidir/i);
});

/* ---------- A2: call ↔ lead matching (Carlos Ramírez vs «Carlos y Luciana Quito») ---------- */

test("a call stamped on Carlos Ramírez by the old first-name match is not mixed into his ficha", () => {
  assert.equal(callNamesSomeoneElse("Carlos Ramírez", "Carlos y Luciana Quito"), true);
  assert.equal(callNamesSomeoneElse("Carlos Ramírez", "Carlos Ramirez"), false);
  assert.equal(callNamesSomeoneElse("Carlos Ramírez", "Carlos"), false);
  const lead = { id: "cmupoj6w50004i904csdnras3", name: "Carlos Ramírez" };
  const calls = [
    call({ id: "own", leadName: "Carlos Ramírez", filingJson: { lead_id: lead.id } }),
    call({
      id: "cmu4n8yiz0002jt04zjzhlcs6",
      leadName: "Carlos y Luciana Quito",
      filingJson: { lead_id: lead.id, notas_crm: "Llamada real de admision con Carlos y Luciana Quito para su minimarket." },
    }),
  ];
  assert.deepEqual(callsForPerson(lead, calls).map((row) => row.id), ["own"]);
  const facts = buildPersonFacts({ lead: { ...lead, status: "" }, calls: callsForPerson(lead, calls), now: NOW });
  assert.equal(facts.details.notas.some((note) => /Luciana|minimarket/.test(note)), false);
  // Cash typed on that call never lands on Carlos Ramírez.
  assert.equal(leadForCashCall([{ id: lead.id, name: lead.name }], calls[1]), null);
  assert.equal(leadForCashCall([{ id: lead.id, name: lead.name }], calls[0])?.id, lead.id);
});

/* ---------- A3: summary fragments ---------- */

test("template fragments and call descriptions never become the summary", () => {
  const today = "2026-10-09";
  assert.equal(agreementSummary({ agreements: ["(segunda reunión, pago, decisión, retomar)."], today }).text, UNCLEAR_NEXT_STEP);
  assert.equal(
    agreementSummary({ agreements: [""], notes: ["Llamada de seguimiento para ver cómo arranca el programa."], today }).text,
    UNCLEAR_NEXT_STEP,
  );
  assert.equal(
    agreementSummary({ agreements: [""], notes: ["Llamada real de admision con Carlos y Luciana Quito para su minimarket."], today }).text,
    UNCLEAR_NEXT_STEP,
  );
  assert.equal(UNCLEAR_NEXT_STEP, "No quedó claro el siguiente paso.");
  assert.equal(cleanNote("Llamada de seguimiento para ver cómo arranca el programa."), "");
  assert.equal(cleanNote("Llamada de ventas con Hamilton para el programa Círculo Millonario."), "");
});

/* ---------- A4: one money truth ---------- */

test("Valeria: ficha, CRM row and Comisiones say the same money (1.597 = 1.066 + 531)", () => {
  const deal = dealMoney({ venta: 1597, cash: 1066, saldo: 1064 });
  assert.deepEqual(deal, { total: 1597, pagado: 1066, falta: 531 });
  assert.equal(deal.pagado + deal.falta, deal.total);
  const row = operacionFromCall({
    id: "cmurfqupm0002jn04imwhgoos",
    leadName: "Valeria Ríos",
    estadoAgenda: "CIERRE VENTA",
    ventaTotal: 1597,
    cashCollected: 1066,
    saldoPendiente: 1064,
    filingJson: { saldo_pendiente: 1064 },
  });
  assert.equal(row.saldo, 531);
  const facts = buildPersonFacts({
    lead: { id: "V1", name: "Valeria Ríos", status: "cerrado" },
    calls: [call({ id: "v", leadName: "Valeria Ríos", estadoAgenda: "CIERRE VENTA", ventaTotal: 1597, cashCollected: 1066, saldoPendiente: 1064, filingJson: { lead_id: "V1" } })],
    now: NOW,
  });
  assert.match(facts.details.pagado, /1\.066/);
  assert.match(facts.details.saldo, /531/);
  assert.equal(
    cobradoSinComision([{ cliente: "Valeria Ríos", venta: 1597, cash: 1066, saldo: 1064 }], usd),
    "Cobraste USD 1.066 de 1 persona y falta cobrar USD 531. No sale comisión porque en Ofertas falta decir cómo te pagan.",
  );
  assert.equal(cobradoSinComision([], usd), "Todavía no hay dinero cobrado en llamadas.");
  // Without a sale total, the stored saldo is all we have.
  assert.deepEqual(dealMoney({ cash: 500, saldo: 300 }), { total: 800, pagado: 500, falta: 300 });
  // Chat cuotas written as «de USD 533 a USD 1.066» are still read as one 533 cuota.
  assert.equal(cuotaAmountInNote("Cobrado de Valeria Ríos de USD 533 a USD 1.066 (2ª cuota). ¿Confirmo?", 1597), 533);
});

/* ---------- A5: history and phone ---------- */

test("a ficha opened from a call has that call in the history", () => {
  const facts = buildPersonFacts({ lead: null, name: "Gisella Torres", calls: [], now: NOW, openedFromDay: "2026-09-12" });
  assert.equal(facts.history.length, 1);
  assert.equal(facts.history[0]?.kind, "call");
});

/* ---------- A6: suggested messages ---------- */

test("messages come from the person's facts, in second person, and are honest when nothing is known", () => {
  const consult = personMessages({ firstName: "Carlos", offer: "Círculo Millonario", status: "open", agreed: "Hablar con su socia y responder el viernes.", tipo: "DECISION", objection: "Necesita consultarlo con alguien", decisor: "Su socia", falta: "" });
  assert.ok(consult.length > 0 && consult.length <= 3);
  assert.match(consult[0], /tu socia/);
  for (const text of consult) {
    assert.doesNotMatch(text, /Hablar con su socia y responder el viernes/);
    assert.match(text, /^Hola Carlos/);
  }
  const nothing = personMessages({ firstName: "Gina", offer: "", status: "open", agreed: "", tipo: "", objection: "", decisor: "", falta: "" });
  assert.equal(nothing.length, 1);
  assert.match(nothing[0], /Gina/);
  assert.deepEqual(personMessages({ firstName: "Andrea", offer: "", status: "lost", agreed: "", tipo: "", objection: "", decisor: "", falta: "" }), []);
  const won = personMessages({ firstName: "Valeria", offer: "Programa Concebir", status: "won", agreed: "", tipo: "", objection: "", decisor: "", falta: "USD 531" });
  assert.ok(won.some((text) => /USD 531/.test(text)));
});

/* ---------- B P4: stage buckets, Perdido suggestion, search, counts ---------- */

test("stage buckets: Sin seguimiento aún, 1–2, 3–5, 6–10, Más de 10 (no «3 o más» cap)", () => {
  assert.deepEqual(STAGE_BUCKETS.map((row) => row.label), ["Sin seguimiento aún", "1–2", "3–5", "6–10", "Más de 10"]);
  assert.equal(stageBucket(0), "sin");
  assert.equal(stageBucket(1), "1-2");
  assert.equal(stageBucket(2), "1-2");
  assert.equal(stageBucket(3), "3-5");
  assert.equal(stageBucket(5), "3-5");
  assert.equal(stageBucket(6), "6-10");
  assert.equal(stageBucket(10), "6-10");
  assert.equal(stageBucket(11), "mas-10");
  assert.equal(stageBucket(null), null);
});

test("at 10 tries the ficha only proposes Perdido; it is never applied on its own", () => {
  assert.equal(DEFAULT_FOLLOWUP_TARGET, 10);
  assert.equal(suggestsLost({ count: 9, target: 10 }), false);
  assert.equal(lostSuggestion({ count: 9, target: 10 }, "Carlos"), null);
  const proposal = lostSuggestion({ count: 10, target: 10 }, "Carlos");
  assert.ok(proposal);
  assert.match(proposal.question, /10 seguimientos con Carlos/);
  const ficha = readFileSync(new URL("../components/person-ficha.tsx", import.meta.url), "utf8");
  assert.match(ficha, /Guardar/);
  assert.match(ficha, /resultado: "perdido"/);
  const alerts = readFileSync(new URL("./alerts.ts", import.meta.url), "utf8");
  assert.doesNotMatch(alerts, /intentos >= 3\b/);
  assert.match(alerts, /intentos >= DEFAULT_FOLLOWUP_TARGET/);
});

function followup(partial: Partial<CrmBoardFollowup> & { id: string; cliente: string }): CrmBoardFollowup {
  return { dueAt: "2026-10-09T15:00:00.000Z", proximo: "2026-10-09", hilo: "SEGUIMIENTO", oferta: "Círculo Millonario", ...partial };
}

test("the stage filter keeps only En seguimiento people in that bucket", () => {
  const followups = [
    followup({ id: "a", leadId: "LA", cliente: "Ana Pérez" }),
    followup({ id: "b", leadId: "LB", cliente: "Beto Gómez", dueAt: "2026-10-20T15:00:00.000Z", proximo: "2026-10-20" }),
    followup({ id: "c", leadId: "LC", cliente: "Cata Ruiz", dueAt: "2026-10-21T15:00:00.000Z", proximo: "2026-10-21" }),
  ];
  const stageCounts = { LA: 0, LB: 4, LC: 12 };
  const all = buildCrmBoard({ calls: [], followups, now: NOW, period: "todo", stageCounts });
  assert.equal(all.counts.seguimiento, 3);
  const mid = buildCrmBoard({ calls: [], followups, now: NOW, period: "todo", stageCounts, stageFilter: "3-5" });
  assert.deepEqual([...mid.hoy, ...mid.rows].map((row) => row.name), ["Beto Gómez"]);
  const sin = buildCrmBoard({ calls: [], followups, now: NOW, period: "todo", stageCounts, stageFilter: "sin" });
  assert.deepEqual([...sin.hoy, ...sin.rows].map((row) => row.name), ["Ana Pérez"]);
  const many = buildCrmBoard({ calls: [], followups, now: NOW, period: "todo", stageCounts, stageFilter: "mas-10" });
  assert.deepEqual([...many.hoy, ...many.rows].map((row) => row.name), ["Cata Ruiz"]);
  // Only the En seguimiento tab is filtered (Cerrados/Perdidos have no stage), and a name search ignores it.
  const search = buildCrmBoard({ calls: [], followups, now: NOW, period: "todo", stageCounts, stageFilter: "sin", query: "beto" });
  assert.deepEqual(search.rows.map((row) => row.name), ["Beto Gómez"]);
});

test("a name search looks in every tab and every month (Adriana in Perdidos, Gina in Cerrados last month)", () => {
  const calls = [
    { id: "x1", cliente: "Adriana Salas", fecha: "2026-08-10", estadoAgenda: "SHOW", leadStatus: "perdido", razonNoCierre: "Precio / No tiene dinero" },
    { id: "x2", cliente: "Gina Morales", fecha: "2026-09-02", estadoAgenda: "CIERRE VENTA", venta: 900, cash: 900 },
  ];
  const followups = [followup({ id: "f", leadId: "LF", cliente: "Fabio Díaz" })];
  const adriana = buildCrmBoard({ calls, followups, now: NOW, period: "mes", bucket: "seguimiento", query: "adriana" });
  assert.deepEqual(adriana.rows.map((row) => row.name), ["Adriana Salas"]);
  const gina = buildCrmBoard({ calls, followups, now: NOW, period: "mes", bucket: "seguimiento", query: "Gina" });
  assert.deepEqual(gina.rows.map((row) => row.name), ["Gina Morales"]);
  const none = buildCrmBoard({ calls, followups, now: NOW, period: "mes", query: "zzz" });
  assert.equal(none.empty, "Nadie con ese nombre en tu CRM.");
  // The tab counts stay for the month: search results from other months do not inflate them.
  const plain = buildCrmBoard({ calls, followups, now: NOW, period: "mes" });
  assert.equal(adriana.counts.seguimiento, plain.counts.seguimiento);
});

test("CRM and Inicio say the same «para hoy · en seguimiento» numbers (one computation)", () => {
  const followups = [
    followup({ id: "1", leadId: "L1", cliente: "Uno Pérez", dueAt: "2026-10-08T15:00:00.000Z", proximo: "2026-10-08" }),
    followup({ id: "2", leadId: "L2", cliente: "Dos Pérez" }),
    followup({ id: "3", leadId: "L3", cliente: "Tres Pérez", dueAt: "2026-10-15T15:00:00.000Z", proximo: "2026-10-15" }),
    followup({ id: "4", leadId: "L4", cliente: "Cuatro Pérez", dueAt: "2026-10-16T15:00:00.000Z", proximo: "2026-10-16" }),
  ];
  const inicio = seguimientoCounts(followups.map((row) => ({ ...row, dueAt: row.dueAt || "" })), NOW);
  const board = buildCrmBoard({ calls: [], followups, now: NOW, period: "todo" });
  assert.deepEqual(board.seguimiento, { hoy: inicio.hoy, total: inicio.total });
  assert.equal(board.hoyNote, seguimientoLine(inicio));
  assert.equal(board.hoyNote, "2 personas para hoy · 4 personas en seguimiento");
  const page = readFileSync(new URL("../app/crm/page.tsx", import.meta.url), "utf8");
  assert.match(page, /seguimiento=\{board\.seguimiento\}/);
  assert.doesNotMatch(page, /label: "Leads activos"/);
});

test("the CRM page has one offer filter and explains «Activa» once per view", () => {
  const page = readFileSync(new URL("../app/crm/page.tsx", import.meta.url), "utf8");
  const glance = page.slice(page.indexOf("function AhoraGlance"), page.indexOf("function lastContactByClient"));
  assert.doesNotMatch(glance, /ACTIVA_EXPLAIN/);
  assert.doesNotMatch(page, /setOffer\(row\.productName\)/);
});

/* ---------- Nits and P5 ---------- */

test("chat chips follow the person being discussed", () => {
  assert.deepEqual(chatSuggestions(""), ["¿A quién llamo hoy?", "¿Cuántos seguimientos tengo?", "¿A quién mañana?"]);
  assert.deepEqual(chatSuggestions("Carlos Ramírez"), ["¿En qué quedé con Carlos?", "¿Qué le escribo a Carlos?", "¿A quién llamo hoy?"]);
});

test("chat money proposals say USD", () => {
  const chat = readFileSync(new URL("./hub-crm-chat.ts", import.meta.url), "utf8");
  assert.match(chat, /usdEs\(current\)\} a \$\{usdEs\(next\)\}/);
  assert.match(chat, /change\.field !== "cash"/);
});

test("Llamadas «por confirmar» shows 3 and a «Ver todas»", () => {
  assert.equal(QUEUE_PREVIEW, 3);
  const page = readFileSync(new URL("../app/llamadas/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Ver todas \(/);
});

test("Coach durations read in Spanish and exercises use only real offers", () => {
  assert.equal(spanishDurations("1 hr 35 mins. No hubo venta."), "1 h 35 min. No hubo venta.");
  assert.equal(spanishDurations("48 mins."), "48 min.");
  const block = coachOffersBlock([
    { productName: "Círculo Millonario", productDescription: "Mentoría de implementación empresarial de 6 meses." },
    { productName: "Fertilidad Consciente", productDescription: "Programa de fertilidad." },
  ]);
  assert.match(block, /«Círculo Millonario», «Fertilidad Consciente»/);
  assert.match(block, /Nunca inventes otra oferta/);
  assert.match(coachOffersBlock([]), /no inventes una oferta/);
  const prompt = readFileSync(new URL("./closer-coach-prompt.ts", import.meta.url), "utf8");
  assert.doesNotMatch(prompt, /Nicho inicial: agencias B2B/);
});

test("Ofertas: transcripts named once, description in whole sentences, buttons inside the card", () => {
  const rows = transcriptListRows([
    { id: "1", title: "Carlos Ramírez · 30 sep" },
    { id: "2", title: "Pegado 1 oct" },
    { id: "3", title: "Pegado 1 oct" },
    { id: "4", title: "Pegado 2 oct" },
  ]);
  assert.deepEqual(rows.map((row) => row.label), [
    "Carlos Ramírez · 30 sep",
    "2 transcripciones pegadas el 1 oct",
    "Transcripción pegada el 2 oct",
  ]);
  const preview = offerDescriptionPreview("Círculo Millonario", "Mentoría de 6 meses. Basada en el Método 5E. Incluye visitas. Y más cosas.");
  assert.equal(preview.preview, "Mentoría de 6 meses. Basada en el Método 5E.");
  assert.equal(preview.long, true);
  assert.doesNotMatch(preview.preview, /…/);
  const page = readFileSync(new URL("../app/ofertas/page.tsx", import.meta.url), "utf8");
  const card = page.slice(page.indexOf('aria-label="Datos de la oferta"'), page.indexOf("</section>", page.indexOf('aria-label="Datos de la oferta"')));
  assert.match(card, /Añadir \/ pegar oferta/);
  assert.match(card, /"Ajustar"/);
  assert.match(card, /Añadir llamadas/);
});
