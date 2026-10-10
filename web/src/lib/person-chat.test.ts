import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FOLLOWUP_TARGET, followupStage, followupTarget, isAttempt, stageLabel } from "@/lib/followup-stage";
import { agreementSummary, UNCLEAR_NEXT_STEP, wholeSentences } from "@/lib/agreement-summary";
import { resolvePerson, whichOneQuestion } from "@/lib/person-resolve";
import { answerAboutPerson, chatTopic, decideChatTurn, groundedReply, isListQuestion, writeUsesPronoun, writeWithContext } from "@/lib/crm-chat";
import { buildPersonFacts, personStage, stagesByLead, type FactCall } from "@/lib/person-facts";
import { fichaDetailRows, fichaFromBoard, fichaFromCall, fichaFromCommission, fichaFromFollowup, fichaFromInicio, fichaFromOperacion, fichaUrl } from "@/lib/ficha-target";
import { operacionGlance, rowStage } from "@/lib/crm-glance";
import { readFileSync } from "node:fs";
import { buildCrmBoard } from "@/lib/crm-board";
import { buildInicioList, derivedFollowupMessages, nextStepText } from "@/lib/inicio-view";
import { crmAskRoute } from "@/lib/crm-ask";

const NOW = new Date("2026-10-09T15:00:00.000Z");

const PEOPLE = [
  { id: "l-elber", name: "Elber" },
  { id: "l-gina", name: "Gina Magaly Gomez Peña de Vargas" },
  { id: "l-carlos-r", name: "Carlos Ramírez" },
  { id: "l-carlos-q", name: "Carlos Quito" },
  { id: "l-valeria", name: "Valeria Ríos" },
];

function call(over: Partial<FactCall> & { filing?: Record<string, unknown> } = {}): FactCall {
  const { filing, ...rest } = over;
  return {
    id: "c1",
    leadName: "Elber",
    estadoAgenda: "SHOW",
    recordedAt: new Date("2026-09-15T16:00:00.000Z"),
    filingJson: { lead_id: "l-elber", ...(filing || {}) },
    ...rest,
  };
}

function call0(filing: Record<string, unknown>): FactCall {
  return call({ id: "c-v", leadName: "Valeria Ríos", filing: { lead_id: "l-v", ...filing } });
}

function elberFacts() {
  return buildPersonFacts({
    lead: {
      id: "l-elber",
      name: "Elber",
      offerName: "Círculo Millonario",
      status: "seguimiento",
      telefono: "",
      nextStep: "",
      razonNoCierre: "Precio / No tiene dinero",
      decider: "Su socio",
    },
    calls: [
      call({
        filing: {
          acuerdo_seguimiento: "El cliente evaluará la propuesta enviada y dará una respuesta o decisión.",
          notas_crm: "Llamada comercial incompleta, se corta la transcripción durante el pitch.",
          tipo_seguimiento: "DECISION",
          proximo_seguimiento: "2026-09-23",
          venta_total: 3000,
          modo_pago: "3 CUOTAS",
        },
      }),
    ],
    alerts: [
      { id: "a1", resolvedAt: new Date("2026-09-25T15:00:00.000Z"), resultado: "no_contesto" },
      { id: "a2", resolvedAt: new Date("2026-10-02T15:00:00.000Z"), resultado: "hecho" },
      { id: "a3", dueAt: new Date("2026-10-05T15:00:00.000Z"), resolvedAt: null, type: "DECISION" },
    ],
    now: NOW,
  });
}

test("stage: hecho and no contestó count since the last call, a new call resets, closed has none", () => {
  assert.equal(DEFAULT_FOLLOWUP_TARGET, 10);
  assert.equal(followupTarget(null), 10);
  assert.equal(followupTarget(6), 6);
  assert.equal(stageLabel(0, 10), "Sin seguimiento aún");
  assert.equal(stageLabel(4, 10), "Seguimiento 4 de 10");
  const attempts = [
    { at: "2026-09-20T15:00:00Z", resultado: "no_contesto" },
    { at: "2026-09-22T15:00:00Z", resultado: "hecho" },
    { at: "2026-09-24T15:00:00Z", resultado: "reprogramado" },
    { at: "2026-10-03T15:00:00Z", resultado: "no_contestó" },
  ];
  assert.equal(followupStage({ callDates: ["2026-09-15T15:00:00Z"], attempts })?.label, "Seguimiento 3 de 10");
  // A call on 1 oct resets: only the 3 oct attempt is after it.
  assert.equal(followupStage({ callDates: ["2026-09-15T15:00:00Z", "2026-10-01T15:00:00Z"], attempts })?.count, 1);
  assert.equal(followupStage({ callDates: ["2026-10-05T15:00:00Z"], attempts })?.label, "Sin seguimiento aún");
  assert.equal(followupStage({ status: "perdido", callDates: [], attempts }), null);
  assert.equal(followupStage({ status: "cerrado", callDates: [], attempts }), null);
  // The same clicks written on the call are not counted twice.
  assert.equal(
    followupStage({ callDates: ["2026-09-15T15:00:00Z"], attempts, lastCallAttempts: { contactos: 2, resultado: "hecho" } })?.count,
    3,
  );
  assert.equal(followupStage({ callDates: ["2026-09-15T15:00:00Z"], attempts: [], lastCallAttempts: { contactos: 2 } })?.count, 2);
});

test("stage: no se presentó, reprogramado and anything else are not follow-up attempts", () => {
  const call = ["2026-09-15T15:00:00Z"];
  const notAttempts = ["no_mostro", "no_se_presento", "reprogramado", "mostro", "perdido", "cerrado", "enviado", "", null];
  for (const resultado of notAttempts) {
    assert.equal(isAttempt(resultado), false, String(resultado));
    assert.equal(followupStage({ callDates: call, attempts: [{ at: "2026-09-20T15:00:00Z", resultado }] })?.count, 0);
  }
  assert.equal(isAttempt("Hecho"), true);
  assert.equal(isAttempt("No contestó"), true);
  const mixed = [
    { at: "2026-09-16T15:00:00Z", resultado: "no_mostro" },
    { at: "2026-09-17T15:00:00Z", resultado: "reprogramado" },
    { at: "2026-09-18T15:00:00Z", resultado: "no_contesto" },
    { at: "2026-09-19T15:00:00Z", resultado: "reprogramado" },
    { at: "2026-09-20T15:00:00Z", resultado: "hecho" },
  ];
  assert.equal(followupStage({ callDates: call, attempts: mixed })?.label, "Seguimiento 2 de 10");
  // The old seguimiento_intentos counter (it also went up on no se presentó / reprogramado) is ignored.
  const legacy = { intentos: 5, resultado: "reprogramado" } as unknown as { contactos?: number; resultado?: string };
  assert.equal(followupStage({ callDates: call, attempts: [], lastCallAttempts: legacy })?.count, 0);
  assert.equal(followupStage({ callDates: call, attempts: [], lastCallAttempts: { resultado: "no_mostro" } })?.count, 0);
  // An old call whose latest result was No contestó still counts once.
  assert.equal(followupStage({ callDates: call, attempts: [], lastCallAttempts: { resultado: "no_contesto" } })?.count, 1);
  // The ficha reads the real counter, not seguimiento_intentos.
  const facts = buildPersonFacts({
    lead: { id: "l-v", name: "Valeria Ríos", status: "seguimiento" },
    calls: [call0({ seguimiento_intentos: 4, seguimiento_resultado: "reprogramado", seguimiento_contactos: 1 })],
    alerts: [],
    now: NOW,
  });
  assert.equal(facts.stage?.label, "Seguimiento 1 de 10");
});

test("summary: the agreement, never the recording; nothing invented when it is missing", () => {
  const meta = agreementSummary({
    agreements: ["Llamada comercial incompleta, se corta la transcripción durante el pitch o diagnóstico final de la propuesta."],
    notes: ["Llamada realizada con Néstor Mollehuara Sicos de Connetsur Comunicaciones. La transcripción se corta a mitad de la conversación y no llega"],
  });
  assert.equal(meta.clear, false);
  assert.equal(meta.text, UNCLEAR_NEXT_STEP);
  assert.equal(meta.text, "No quedó claro el siguiente paso.");
  const cut = wholeSentences("Quedó en enviarle el link de pago hoy. Hablaron del centro de estimulación temprana, pero la llamada");
  assert.equal(cut, "Quedó en enviarle el link de pago hoy.");
  assert.doesNotMatch(cut, /pero la llamada|…/);
  const full = agreementSummary({
    agreements: ["", "Quedó en revisar la propuesta con su socio"],
    tipo: "DECISION",
    proximo: "2026-10-12",
    today: "2026-10-09",
  });
  assert.equal(full.clear, true);
  assert.equal(full.text, "Quedó en revisar la propuesta con su socio. Falta su respuesta, para el 12 oct.");
  const notes = agreementSummary({
    agreements: [],
    notes: ["Llamada comercial donde se diagnosticaron problemas de gestión. Quedó en mandar el comprobante de la reserva."],
  });
  assert.equal(notes.text, "Quedó en mandar el comprobante de la reserva.");
  const story = agreementSummary({ agreements: [], notes: ["Tiene un centro de estimulación temprana con 12 empleados."] });
  assert.equal(story.clear, false);
});

test("Inicio and CRM rows drop recording talk and keep sentences whole", () => {
  const row = (over: Record<string, unknown>) => ({ id: "x", cliente: "Jessica", dueAt: "2026-09-23T15:00:00.000Z", proximo: "2026-09-23", hilo: "SEGUIMIENTO", ...over });
  assert.equal(
    nextStepText(row({ acuerdo: "Llamada comercial incompleta, se corta la transcripción durante el pitch." }), NOW),
    "Seguimiento pendiente desde el 23 sep",
  );
  const long = nextStepText(
    row({ callNote: "Quedó en revisar la propuesta con su esposo y responder el lunes, después de ver los números del centro de estimulación temprana que dirige con su hermana desde hace años, pero la llamada" }),
    NOW,
  );
  assert.doesNotMatch(long, /pero la llamada$/);
});

test("suggested messages read naturally and never paste the summary", () => {
  const step = "Llamada de seguimiento para ver cómo arranca el programa.";
  const lines = derivedFollowupMessages({ name: "Valeria Ríos", offer: "Fertilidad Consciente", step });
  assert.equal(lines.length >= 2, true);
  assert.equal(lines.some((line) => line.toLowerCase().includes(step.toLowerCase().replace(/\.$/, ""))), false);
  assert.match(lines[0], /^Hola Valeria, /);
  assert.equal(lines.some((line) => /te escribo por lo que quedamos:/.test(line)), false);
  const list = buildInicioList({
    followups: [{ id: "a1", leadId: "l-valeria", cliente: "Valeria Ríos", dueAt: "2026-10-09T22:00:00.000Z", proximo: "2026-10-09 17:00", leadNextStep: step }],
    rules: [],
    now: NOW,
  });
  assert.equal(list.rows[0].leadId, "l-valeria");
  assert.equal(list.rows[0].messages.some((line) => line.includes("Llamada de seguimiento para ver")), false);
});

test("names: full name, leadId and two people with the same first name", () => {
  const gina = resolvePerson("¿En qué quedé con Gina Magaly Gomez Peña de Vargas?", PEOPLE);
  assert.equal(gina.kind, "one");
  assert.equal(gina.kind === "one" && gina.person.id, "l-gina");
  const short = resolvePerson("¿Qué pasó con Gina Vargas?", PEOPLE);
  assert.equal(short.kind === "one" && short.person.id, "l-gina");
  const byId = resolvePerson("¿En qué quedé?", PEOPLE, { leadId: "l-carlos-r" });
  assert.equal(byId.kind === "one" && byId.via, "id");
  const carlos = resolvePerson("¿en qué quedé con Carlos?", PEOPLE);
  assert.equal(carlos.kind, "ambiguous");
  assert.equal(
    carlos.kind === "ambiguous" && whichOneQuestion(carlos.options),
    "Hay dos Carlos: Carlos Ramírez y Carlos Quito. ¿Cuál?",
  );
  const carlosR = resolvePerson("¿en qué quedé con Carlos Ramírez?", PEOPLE);
  assert.equal(carlosR.kind === "one" && carlosR.person.id, "l-carlos-r");
  const vargas = resolvePerson("¿En qué quedé con Juan Vargas?", PEOPLE);
  assert.equal(vargas.kind, "unknown");
  assert.equal(vargas.kind === "unknown" && vargas.spoken, "Juan Vargas");
});

test("chat: the exact question, from that person's data, and «y…» keeps the person", () => {
  const facts = elberFacts();
  assert.equal(chatTopic("¿qué objeción puso Elber?"), "objecion");
  assert.equal(chatTopic("¿en qué quedé con Elber?"), "acuerdo");
  assert.equal(chatTopic("¿y cuándo hablamos por última vez?"), "ultimo");
  const objection = answerAboutPerson(facts, "objecion", NOW);
  const agreement = answerAboutPerson(facts, "acuerdo", NOW);
  assert.notEqual(objection, agreement);
  assert.equal(objection, "Lo que frenó a Elber fue el precio: dijo que no tenía el dinero.");
  assert.match(agreement, /^Quedó en revisar la propuesta y dar una respuesta\./);
  assert.doesNotMatch(agreement, /transcripci|se corta/);
  assert.equal(answerAboutPerson(facts, "ultimo", NOW), "Lo último fue un seguimiento el 2 oct (hace 7 días), hecho. La última llamada fue el 15 sep.");

  const first = decideChatTurn({ text: "¿Qué objeción puso Elber?" }, PEOPLE);
  assert.equal(first.kind === "person" && first.person.id, "l-elber");
  const follow = decideChatTurn({ text: "¿y cuándo hablamos por última vez?", contextId: "l-elber" }, PEOPLE);
  assert.equal(follow.kind, "person");
  assert.equal(follow.kind === "person" && follow.person.id, "l-elber");
  assert.equal(follow.kind === "person" && follow.topic, "ultimo");
  const pronoun = decideChatTurn({ text: "¿Cuánto pagó ella?", contextId: "l-valeria" }, PEOPLE);
  assert.equal(pronoun.kind === "person" && pronoun.person.id, "l-valeria");
  const list = decideChatTurn({ text: "¿A quién llamo hoy?", contextId: "l-elber" }, PEOPLE);
  assert.equal(list.kind, "list");
  assert.equal(isListQuestion("¿Cuántos seguimientos tengo?"), true);
  const lost = decideChatTurn({ text: "¿y qué objeción puso?" }, PEOPLE);
  assert.equal(lost.kind === "ask" && lost.reply, "¿De quién me hablas? Dime el nombre.");
  const ambiguous = decideChatTurn({ text: "¿Qué objeción puso Carlos?" }, PEOPLE);
  assert.equal(ambiguous.kind === "ask" && /¿Cuál\?/.test(ambiguous.reply), true);
});

test("chat: the model reply is only kept when its numbers are in the facts", () => {
  const facts = { pagado: "USD 500", proximo: "Le toca el 12 oct" };
  assert.equal(groundedReply("Te toca escribirle el 12 oct.", facts, ""), "Te toca escribirle el 12 oct.");
  assert.equal(groundedReply("Pagó USD 900.", facts, ""), "");
  assert.equal(groundedReply("La transcripción se corta.", facts, ""), "");
});

test("ficha: stage, details and history from stored rows", () => {
  const facts = elberFacts();
  assert.equal(facts.stage?.label, "Seguimiento 2 de 10");
  assert.equal(facts.openAlertId, "a3");
  assert.equal(facts.phone, "");
  assert.equal(facts.history[0].label, "Seguimiento · Hecho");
  assert.equal(facts.history.some((item) => item.label === "Seguimiento · No contestó"), true);
  assert.equal(facts.history[facts.history.length - 1].label, "Llamada · Asistió");
  const rows = fichaDetailRows(facts);
  assert.deepEqual(
    rows.map((row) => row.label),
    ["Quién decide", "Objeciones", "Presupuesto y forma de pago", "Acuerdos", "Razón de no cierre", "Notas"],
  );
  assert.equal(rows[0].values[0], "Su socio");
  assert.match(rows[2].values[0] || "", /3[.,]000/);
  assert.equal(facts.details.notas.some((line) => /transcripci/.test(line)), false);
  assert.equal(facts.messages.some((line) => /el cliente evaluará/i.test(line)), false);
  const lost = buildPersonFacts({ lead: { id: "x", name: "Ana", status: "perdido" }, calls: [], now: NOW });
  assert.equal(lost.stage, null);
  assert.equal(lost.messages.length, 0);
});

test("ficha opens the same way from Inicio, CRM (every tab) and Llamadas", () => {
  const fromInicio = fichaFromInicio({ id: "alert-1", name: "Carlos Ramírez", leadId: "l-carlos-r", messages: ["Hola Carlos"] });
  assert.equal(fichaUrl(fromInicio), "/api/crm/ficha?leadId=l-carlos-r&name=Carlos+Ram%C3%ADrez");
  assert.equal(fromInicio.alertId, "alert-1");
  const fromCall = fichaFromCall({ id: "fathom-9", leadName: "Gina Magaly Gomez Peña de Vargas", callRecordId: "cr-9" });
  assert.match(fichaUrl(fromCall), /callId=cr-9/);
  const oldCall = fichaFromCall({ id: "upload-3", leadName: "Laura Calero" });
  assert.match(fichaUrl(oldCall), /callId=upload-3&name=Laura\+Calero/);
  const board = buildCrmBoard({
    calls: [
      { id: "c-g", leadId: "l-gina", cliente: "Gina Magaly Gomez Peña de Vargas", fecha: "2026-10-03", leadStatus: "perdido", razonNoCierre: "No era el momento" },
      { id: "c-c", leadId: "l-carlos-r", cliente: "Carlos Ramírez", fecha: "2026-10-01" },
    ],
    followups: [{ id: "a-c", leadId: "l-carlos-r", cliente: "Carlos Ramírez", dueAt: "2026-10-09T15:00:00.000Z", proximo: "2026-10-09" }],
    bucket: "perdidos",
    period: "mes",
    now: NOW,
  });
  const gina = board.rows.find((person) => person.name.startsWith("Gina"));
  assert.ok(gina, "Gina is in Perdidos");
  assert.equal(gina?.leadId, "l-gina");
  assert.equal(fichaUrl(fichaFromBoard(gina!)).includes("leadId=l-gina"), true);
  const carlos = board.hoy.find((person) => person.name === "Carlos Ramírez");
  assert.equal(carlos?.alertId, "a-c");
  assert.equal(carlos?.leadId, "l-carlos-r");
});

test("chat routing: questions go to the person answer, writes still wait for «Guardar»", () => {
  assert.equal(crmAskRoute("¿Qué objeción puso Elber?", false), "ask");
  assert.equal(crmAskRoute("Carlos Ramírez me pagó 500", false), "hub");
  assert.equal(crmAskRoute("sí", true), "hub");
  assert.equal(crmAskRoute("sí", false), "ask");
});

test("chat writes with a pronoun go to the person being discussed, or ask who", () => {
  const valeria = { name: "Valeria Ríos", leadId: "l-valeria" };
  assert.equal(writeUsesPronoun("él me pagó 500"), true);
  assert.equal(writeUsesPronoun("Elber pagó 200"), false);
  assert.deepEqual(writeWithContext("él me pagó 500", PEOPLE, valeria), {
    kind: "send",
    text: "Valeria Ríos me pagó 500",
    name: "Valeria Ríos",
    leadId: "l-valeria",
  });
  assert.equal(writeWithContext("Ella me pagó 500", PEOPLE, valeria).kind, "send");
  const escribi = writeWithContext("a ella le escribí", PEOPLE, valeria);
  assert.equal(escribi.kind === "send" && escribi.text, "a Valeria Ríos le escribí");
  const hable = writeWithContext("hablé con él ayer", PEOPLE, { name: "Elber", leadId: "l-elber" });
  assert.equal(hable.kind === "send" && hable.text, "hablé con Elber ayer");
  const noSubject = writeWithContext("le escribí ayer", PEOPLE, valeria);
  assert.equal(noSubject.kind === "send" && noSubject.text, "Valeria Ríos: le escribí ayer");
  // A name written in the message wins over the chat context.
  const named = writeWithContext("Elber me pagó 500 y ella no", PEOPLE, valeria);
  assert.equal(named.kind === "send" && named.name, "Elber");
  assert.equal(named.kind === "send" && named.text, "Elber me pagó 500 y ella no");
  // Nobody in the chat yet → ask who, never guess.
  const ask = writeWithContext("él me pagó 500", PEOPLE, null);
  assert.equal(ask.kind, "ask");
  assert.match(ask.kind === "ask" ? ask.reply : "", /¿De quién hablas/);
  assert.equal(writeWithContext("le escribí ayer", PEOPLE, null).kind, "ask");
  // Two Carlos and none in context → which one; the one in context → that one.
  const two = writeWithContext("Carlos me pagó 500, él dijo que sí", PEOPLE, null);
  assert.equal(two.kind === "ask" && two.reply, "Hay dos Carlos: Carlos Ramírez y Carlos Quito. ¿Cuál?");
  const picked = writeWithContext("Carlos me pagó 500, él dijo que sí", PEOPLE, { name: "Carlos Ramírez" });
  assert.equal(picked.kind === "send" && picked.text, "Carlos Ramírez me pagó 500, él dijo que sí");
  // A write without a pronoun is not touched, and «a ella le escribí» reaches the write path (¿Confirmo? → Guardar).
  assert.deepEqual(writeWithContext("Elber pagó 200", PEOPLE, valeria), { kind: "send", text: "Elber pagó 200" });
  assert.equal(crmAskRoute("a ella le escribí", false), "hub");
  assert.equal(crmAskRoute("él me pagó 500", false), "hub");
  // The chat client uses it before posting to the hub, and remembers who the answer was about.
  const client = readFileSync(new URL("../components/crm-ask.tsx", import.meta.url), "utf8");
  assert.match(client, /writeWithContext\(text, people, contextPersonRef\.current\)/);
  assert.match(client, /askHub\(text, target\.text\)/);
  assert.match(client, /contextPersonRef\.current = \{ name: data\.name/);
});

test("CRM «Ver todas las columnas» names open the same ficha, with the same stage", () => {
  assert.deepEqual(fichaFromOperacion({ id: "c-1", cliente: "Carlos Ramírez", leadId: "l-carlos-r", producto: "Círculo" }), {
    name: "Carlos Ramírez",
    leadId: "l-carlos-r",
    callId: "c-1",
    initial: { offer: "Círculo" },
  });
  const followup = fichaFromFollowup({ id: "a-7", cliente: "Valeria Ríos", leadId: "l-valeria", callId: "c-2", tipo: "DECISION" });
  assert.equal(followup.alertId, "a-7");
  assert.equal(fichaUrl(followup), "/api/crm/ficha?leadId=l-valeria&callId=c-2&name=Valeria+R%C3%ADos");
  assert.equal(fichaFromFollowup({ id: "a-8", cliente: "X", tipo: "AGENDA_CHECK" }).alertId, undefined);
  assert.equal(fichaFromCommission({ cliente: "Elber", leadId: "l-elber" })?.leadId, "l-elber");
  assert.equal(fichaFromCommission({ cliente: "" }), null);
  const page = readFileSync(new URL("../app/crm/page.tsx", import.meta.url), "utf8");
  assert.match(page, /onOpenPerson=\{\(row\) => setFicha\(fichaFromOperacion/);
  assert.match(page, /onOpenPerson=\{\(row\) => setFicha\(fichaFromFollowup\(row\)\)\}/);
  assert.match(page, /fichaFromCommission\(row\)/);
  assert.equal((page.match(/<PersonNameButton/g) || []).length >= 4, true);
  assert.doesNotMatch(page, /derivedPaso|label: "Paso"|\["Paso"/);

  // Stage per lead for the sheets = the ficha's stage.
  const calls: FactCall[] = [
    call({ id: "c-v", leadName: "Valeria Ríos", recordedAt: new Date("2026-09-15T16:00:00Z"), filing: { lead_id: "l-valeria" } }),
    call({ id: "c-e", leadName: "Elber", filing: { lead_id: "l-elber" } }),
    call({ id: "c-x", leadName: "Sin Lead", filing: { lead_id: "" } }),
  ];
  const alerts = [
    { leadId: "l-valeria", resolvedAt: new Date("2026-09-20T15:00:00Z"), resultado: "no_contesto" },
    { leadId: "l-valeria", resolvedAt: new Date("2026-09-21T15:00:00Z"), resultado: "reprogramado" },
    { leadId: "l-valeria", resolvedAt: new Date("2026-09-22T15:00:00Z"), resultado: "hecho" },
  ];
  const stages = stagesByLead({
    leads: [
      { id: "l-valeria", name: "Valeria Ríos", status: "seguimiento" },
      { id: "l-elber", name: "Elber", status: "perdido" },
    ],
    calls,
    alerts,
  });
  assert.equal(stages["l-valeria"], "Seguimiento 2 de 10");
  assert.equal(stages["l-elber"], "");
  assert.equal(stages["call:c-x"], "Sin seguimiento aún");
  assert.equal(
    personStage({ lead: { status: "seguimiento" }, calls: [calls[0]], alerts })?.label,
    stages["l-valeria"],
  );
  assert.equal(operacionGlance({ etapa: rowStage(stages, { leadId: "l-valeria" }) }).line.startsWith("Seguimiento 2 de 10"), true);
});
