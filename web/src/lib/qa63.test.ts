import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { callNamesSomeoneElse, trustedLeadId } from "./lead-match";
import { buildCrmBoard, rowStageBucket, type CrmBoardCall, type CrmBoardFollowup } from "./crm-board";
import { STAGE_BUCKETS } from "./followup-stage";
import { buildPersonFacts, nextCuotaSentence, type FactCall } from "./person-facts";
import { chatSuggestions } from "./crm-chat";
import { isInventedExercise, notesForPrompt, staleExerciseCopy } from "./coach-grounding";
import { CLOSER_COACH_SYSTEM_PROMPT } from "./closer-coach-prompt";
import { defaultCoachNotes } from "./closer-coach";
import { CONFIRM_DELETE_TITLE } from "./coach-analysis";
import { outsideCrmPeople } from "./crm-search";
import { cobradoSinComision } from "./deal-money";

const NOW = new Date("2026-10-09T15:00:00Z");
const usd = (n: number) => `USD ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const CARLOS = "cmupoj6w50004i904csdnras3";
const QUITO_CALL = "cmu4n8yiz0002jt04zjzhlcs6";

/* ---------- 1. «Carlos y Luciana Quito» is not Carlos Ramírez ---------- */

test("a call stamped with Carlos Ramírez's lead but naming «Carlos y Luciana Quito» is its own person", () => {
  assert.equal(callNamesSomeoneElse("Carlos Ramírez", "Carlos y Luciana Quito"), true);
  assert.equal(callNamesSomeoneElse("Carlos Ramírez", "Carlos Ramírez"), false);
  assert.equal(callNamesSomeoneElse("Carlos Ramírez", "Carlos"), false);
  const leads = [{ id: CARLOS, name: "Carlos Ramírez" }];
  assert.equal(trustedLeadId(CARLOS, "Carlos y Luciana Quito", leads), "");
  assert.equal(trustedLeadId(CARLOS, "Carlos Ramírez", new Map([[CARLOS, "Carlos Ramírez"]])), CARLOS);
  assert.equal(trustedLeadId("", "Carlos Ramírez", leads), "");
  // Unknown lead id: keep the stamp.
  assert.equal(trustedLeadId("other", "Carlos y Luciana Quito", leads), "other");
});

const carlosCalls: CrmBoardCall[] = [
  // The Quito call, unlinked by trustedLeadId: Perdido by razón, no follow-up.
  { id: QUITO_CALL, leadId: "", cliente: "Carlos y Luciana Quito", fecha: "2026-10-01", estadoAgenda: "SHOW", razonNoCierre: "Precio / No tiene dinero" },
  // Carlos Ramírez: his call follow-up was closed with «Hecho», no new date.
  { id: "cmur8ke0z0002if04d0gqia7p", leadId: CARLOS, cliente: "Carlos Ramírez", fecha: "2026-09-30", estadoAgenda: "SHOW", seguimientoResultado: "hecho" },
];

test("search «Carlos» finds Carlos y Luciana Quito (Perdido, own row) and Carlos Ramírez (own row)", () => {
  const board = buildCrmBoard({ calls: carlosCalls, followups: [], now: NOW, period: "todo", bucket: "perdidos", query: "carlos" });
  const quito = board.rows.find((row) => row.name === "Carlos y Luciana Quito");
  const carlos = board.rows.find((row) => row.name === "Carlos Ramírez");
  assert.ok(quito, "Quito row");
  assert.equal(quito.leadId, "");
  assert.equal(quito.callId, QUITO_CALL);
  assert.equal(quito.chip?.label, "Perdido");
  assert.ok(carlos, "Carlos row");
  assert.equal(carlos.leadId, CARLOS);
  assert.equal(carlos.chip?.label, "Sin fecha de seguimiento");
});

/* ---------- 4. Adriana only exists as a Fathom recording ---------- */

test("search finds a person who only exists on a call outside the CRM (Adriana)", () => {
  const outside = outsideCrmPeople([
    { id: "cmtukq0wu000rl204h2njwl3s", title: "Adriana Muñeton", recordedAt: "2026-09-12T20:00:00Z" },
    { id: "dup", title: "Adriana Muñeton", recordedAt: "2026-09-01T20:00:00Z" },
    { id: "meet", title: "Reunión 12/09 · equipo" },
  ]);
  assert.deepEqual(outside, [{ id: "cmtukq0wu000rl204h2njwl3s", name: "Adriana Muñeton", day: "2026-09-12" }]);
  const board = buildCrmBoard({ calls: [], followups: [], now: NOW, period: "mes", query: "adriana", outsideCrm: outside });
  assert.deepEqual(board.rows.map((row) => [row.name, row.chip?.label, row.day]), [["Adriana Muñeton", "No está en tu CRM", "2026-09-12"]]);
  // Without a search, she is not in any tab.
  const plain = buildCrmBoard({ calls: [], followups: [], now: NOW, period: "mes", outsideCrm: outside });
  assert.equal(plain.rows.length + plain.hoy.length, 0);
});

/* ---------- 3. Stage filter filters the En seguimiento list ---------- */

function followup(partial: Partial<CrmBoardFollowup> & { id: string; cliente: string }): CrmBoardFollowup {
  return { dueAt: "2026-10-20T15:00:00.000Z", proximo: "2026-10-20", hilo: "SEGUIMIENTO", ...partial };
}

test("stage buckets add up to the En seguimiento total; no stage → «Sin seguimiento aún»; hoy is not filtered", () => {
  const followups = [
    followup({ id: "a", leadId: "LA", cliente: "Ana Pérez", dueAt: "2026-10-09T15:00:00.000Z", proximo: "2026-10-09" }),
    followup({ id: "b", leadId: "LB", cliente: "Beto Gómez" }),
    followup({ id: "c", leadId: "LC", cliente: "Cata Ruiz" }),
    followup({ id: "d", leadId: "LD", cliente: "Dani Mora" }),
    followup({ id: "e", leadId: "LE", cliente: "Eva Luna" }),
  ];
  const stageCounts = { LA: 2, LB: 4, LC: 12, LD: null };
  const all = buildCrmBoard({ calls: [], followups, now: NOW, period: "todo", stageCounts });
  const total = all.counts.seguimiento;
  assert.equal(total, 5);
  let sum = 0;
  for (const bucket of STAGE_BUCKETS) {
    const board = buildCrmBoard({ calls: [], followups, now: NOW, period: "todo", stageCounts, stageFilter: bucket.id });
    assert.equal(board.counts.seguimiento, board.rows.length, bucket.id);
    assert.deepEqual(board.hoy.map((row) => row.name), all.hoy.map((row) => row.name), `hoy untouched for ${bucket.id}`);
    sum += board.counts.seguimiento;
  }
  assert.equal(sum, total);
  const sin = buildCrmBoard({ calls: [], followups, now: NOW, period: "todo", stageCounts, stageFilter: "sin" });
  assert.deepEqual(sin.rows.map((row) => row.name).sort(), ["Dani Mora", "Eva Luna"]);
  // Someone in «A quién contactar hoy» is also in the filtered list.
  const low = buildCrmBoard({ calls: [], followups, now: NOW, period: "todo", stageCounts, stageFilter: "1-2" });
  assert.deepEqual(low.rows.map((row) => row.name), ["Ana Pérez"]);
  assert.equal(rowStageBucket(null), "sin");
  assert.equal(rowStageBucket(undefined), "sin");
  assert.equal(rowStageBucket(0), "sin");
});

test("the stage filter keeps working while searching", () => {
  const followups = [followup({ id: "b", leadId: "LB", cliente: "Beto Gómez" }), followup({ id: "c", leadId: "LC", cliente: "Beto Ruiz" })];
  const stageCounts = { LB: 4, LC: 12 };
  const board = buildCrmBoard({ calls: [], followups, now: NOW, period: "todo", stageCounts, stageFilter: "mas-10", query: "beto" });
  assert.deepEqual(board.rows.map((row) => row.name), ["Beto Ruiz"]);
});

test("the CRM subtitle always shows the perdidos of the month, also 0", () => {
  const board = buildCrmBoard({ calls: [], followups: [], now: NOW, period: "mes" });
  assert.match(board.subtitle, /0 perdidos este mes/);
});

test("the stage select stays visible while searching and has room for «Sin seguimiento aún»", () => {
  const source = readFileSync(new URL("../components/crm-board.tsx", import.meta.url), "utf8");
  assert.match(source, /bucket === "seguimiento" \|\| query\.trim\(\)/);
  assert.match(source, /min-w-\[13\.5rem\]/);
});

/* ---------- 5. A Cerrado's summary ---------- */

function call(partial: Partial<FactCall> & { id: string }): FactCall {
  return { recordedAt: "2026-09-20T15:00:00Z", ...partial };
}

test("nextCuotaSentence keeps only the next cuota", () => {
  assert.equal(nextCuotaSentence("Segunda reunión agendada.", undefined, "2026-10-09"), "");
  assert.equal(nextCuotaSentence("Pagó la primera cuota. Pagará la segunda cuota el 15 de octubre.", undefined, "2026-10-09"), "Pagará la segunda cuota el 15 de octubre.");
  assert.match(nextCuotaSentence("Segunda reunión agendada.", { type: "COBRAR_CUOTA", dueAt: "2026-10-15T15:00:00Z" }, "2026-10-09"), /^Próxima cuota: .+\.$/);
  assert.equal(nextCuotaSentence("", { type: "SEGUIMIENTO", dueAt: "2026-10-15T15:00:00Z" }, "2026-10-09"), "");
});

test("Valeria (Cerró): «Cerró. Pagó X de Y; falta Z.» and nothing from before the close", () => {
  const lead = { id: "V1", name: "Valeria Ríos", status: "cerrado" };
  const calls = [
    call({
      id: "cmurfqupm0002jn04imwhgoos",
      leadName: "Valeria Ríos",
      estadoAgenda: "CIERRE VENTA",
      ventaTotal: 1597,
      cashCollected: 1066,
      saldoPendiente: 1064,
      filingJson: { lead_id: "V1", estado_agenda: "CIERRE VENTA", acuerdo_seguimiento: "Segunda reunión agendada." },
    }),
  ];
  const facts = buildPersonFacts({ lead, calls, now: NOW });
  assert.equal(facts.summary.text, "Cerró. Pagó USD 1.066 de USD 1.597; falta USD 531.");
});

test("the history shows a day's call once (Carlos, 30 sep, two copies of the same call)", () => {
  const lead = { id: CARLOS, name: "Carlos Ramírez", status: "seguimiento" };
  const calls = [
    call({ id: "cmur8ke0z0002if04d0gqia7p", leadName: "Carlos Ramírez", recordedAt: "2026-09-30T20:00:00Z", estadoAgenda: "SHOW", filingJson: { lead_id: CARLOS } }),
    call({ id: "cmupoj6u30002i904dfpo7j8g", leadName: "Carlos Ramírez", recordedAt: "2026-09-30T19:00:00Z", estadoAgenda: "SHOW", filingJson: { lead_id: CARLOS } }),
  ];
  const facts = buildPersonFacts({ lead, calls, now: NOW });
  const sept30 = facts.history.filter((item) => item.day === "2026-09-30" && item.kind === "call");
  assert.equal(sept30.length, 1);
});

/* ---------- Nits ---------- */

test("a Perdido gets no «¿Qué le escribo?» chip", () => {
  const chips = chatSuggestions("Carlos y Luciana Quito", "Perdido");
  assert.ok(!chips.some((chip) => /escribo/i.test(chip)));
  assert.ok(chips.includes("¿Por qué se perdió Carlos?"));
  assert.ok(chatSuggestions("Ana Pérez", "En seguimiento").some((chip) => /escribo/i.test(chip)));
});

test("Comisiones says the total sold next to paid and owed", () => {
  assert.match(cobradoSinComision([{ cliente: "Valeria Ríos", venta: 1597, cash: 1066, saldo: 1064 }], usd), /De USD 1\.597 vendidos, cobraste USD 1\.066 .* falta cobrar USD 531/);
  // Fully paid: no «vendidos» repetition.
  assert.match(cobradoSinComision([{ cliente: "Gina", venta: 900, cash: 900 }], usd), /^Cobraste USD 900 de 1 persona\./);
});

test("Práctica shows the offer description whole, like Ofertas", () => {
  const source = readFileSync(new URL("../components/training-setup-form.tsx", import.meta.url), "utf8");
  assert.match(source, /<OfferDescription /);
  assert.doesNotMatch(source, />\{glance\.blurb\}</);
  const component = readFileSync(new URL("../components/offer-description.tsx", import.meta.url), "utf8");
  assert.match(component, /offerDescriptionPreview/);
  assert.match(component, /Ver la descripción completa/);
});

test("the chat proposal card goes away as soon as Guardar / No is tapped", () => {
  const source = readFileSync(new URL("../components/crm-ask.tsx", import.meta.url), "utf8");
  assert.match(source, /answerProposal\("no"\)/);
  assert.match(source, /const answerProposal[\s\S]{0,200}setPending\(""\)/);
});

/* ---------- 2. Coach: no invented exercises, trash with confirmation ---------- */

const AGENCY =
  "Imagina que vendes a una agencia de Publicidad pagada un software B2B de $3,000 al mes. El dueño dice que lo tiene que pensar.";

test("the agency / software B2B / $3,000 al mes exercise is flagged; real-offer exercises are not", () => {
  const offers = [{ productName: "Círculo Millonario", productDescription: "Mentoría para emprendedores." }];
  assert.equal(isInventedExercise(AGENCY, offers), true);
  assert.equal(isInventedExercise(AGENCY, []), true);
  assert.equal(isInventedExercise("Practiquemos Círculo Millonario: el prospecto dice que es caro.", offers), false);
  // The closer's own offer is about agencies: not invented.
  assert.equal(isInventedExercise("Una agencia te dice que lo piensa.", [{ productName: "Agencia Pro", productDescription: "Programa para agencias." }]), false);
  assert.equal(staleExerciseCopy([]).ask, "");
  assert.match(staleExerciseCopy([]).text, /Añade tu oferta/);
  assert.equal(staleExerciseCopy(offers).ask, "Dame un ejercicio con mi oferta Círculo Millonario.");
});

test("no source of the invented exercise is left in the prompt or the default notes", () => {
  // Only the lines that forbid them («nada de agencias…») name them.
  const withoutRule = CLOSER_COACH_SYSTEM_PROMPT.split("\n").filter((line) => !/nada de/.test(line)).join("\n");
  assert.doesNotMatch(CLOSER_COACH_SYSTEM_PROMPT, /b2b-agencies-dfy/i);
  assert.doesNotMatch(withoutRule, /(^|[^a-záéíóúñ])agencias?([^a-záéíóúñ]|$)|publicidad pagada|software b2b|\$3,000 al mes/i);
  assert.match(CLOSER_COACH_SYSTEM_PROMPT, /REGLA DE EJERCICIOS/);
  assert.equal(defaultCoachNotes().niche, "");
  assert.equal(notesForPrompt({ niche: "b2b-agencies-dfy" }).niche, "");
  assert.equal(notesForPrompt({ niche: "coaching" }).niche, "coaching");
});

test("the trash asks «¿Borrar este análisis?» Sí/No and sits apart from «Ver análisis»", () => {
  assert.equal(CONFIRM_DELETE_TITLE, "¿Borrar este análisis?");
  const button = readFileSync(new URL("../components/delete-analysis-button.tsx", import.meta.url), "utf8");
  assert.match(button, /aria-haspopup="dialog"/);
  assert.match(button, /CONFIRM_DELETE_TITLE/);
  assert.match(button, /Sí, borrar/);
  assert.match(button, />\s*No\s*</);
  assert.doesNotMatch(button, /window\.confirm/);
  const page = readFileSync(new URL("../app/coach/page.tsx", import.meta.url), "utf8");
  assert.match(page, /justify-between[\s\S]{0,400}Ver análisis[\s\S]{0,400}<DeleteAnalysisButton/);
});
