import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHubUtterance, parseSpokenDue } from "./hub-utterance";
import { alertPushBody, filingPushBody, formatDueLabel } from "./web-push";

test("hub utterances: wrote, closed, no answer, agenda, lost", () => {
  const friday = new Date("2026-09-18T15:00:00Z"); // Friday
  const wrote = parseHubUtterance("le escribí a Alberto, paga el viernes", friday);
  assert.equal(wrote?.kind, "wrote");
  if (wrote?.kind === "wrote") {
    assert.equal(wrote.name, "alberto");
    assert.equal(wrote.payAt.getDay(), 5);
  }

  const closed = parseHubUtterance("cerré con María, pagó 3,000");
  assert.equal(closed?.kind, "closed");
  if (closed?.kind === "closed") {
    assert.equal(closed.name, "maria");
    assert.equal(closed.amount, 3000);
  }

  const no = parseHubUtterance("no contestó Juan");
  assert.equal(no?.kind, "no_answer");
  if (no?.kind === "no_answer") assert.equal(no.name, "juan");

  const agenda = parseHubUtterance("agendé a Carlos el jueves 3 p.m.", friday);
  assert.equal(agenda?.kind, "agenda");
  if (agenda?.kind === "agenda") {
    assert.equal(agenda.name, "carlos");
    assert.equal(agenda.when.getDay(), 4);
    assert.equal(agenda.when.getHours(), 15);
  }

  const lost = parseHubUtterance("perdí a Pedro, se fue con la competencia");
  assert.equal(lost?.kind, "lost");
  if (lost?.kind === "lost") {
    assert.equal(lost.name, "pedro");
    assert.match(lost.reason, /competencia/);
  }
});

test("spoken due understands hoy and viernes", () => {
  const friday = new Date("2026-09-18T10:00:00");
  const hoy = parseSpokenDue("hoy 2 p.m.", friday);
  assert.equal(hoy?.getHours(), 14);
  const vie = parseSpokenDue("viernes", friday);
  assert.equal(vie?.getDay(), 5);
});

test("push copy matches the closer-facing format", () => {
  const due = new Date("2026-09-18T19:00:00Z");
  const body = alertPushBody({
    type: "PAGO PENDIENTE",
    leadName: "Alberto",
    enJuego: 7000,
    dueAt: due,
    timezone: "UTC",
  });
  assert.match(body, /Cobrar a Alberto/);
  assert.match(body, /USD 7\.000/);
  const filing = filingPushBody({
    leadName: "Alberto",
    offerName: "Círculo Millonario",
    estado: "SHOW",
    followup: "seguimiento mié 2 p.m.",
  });
  assert.equal(
    filing,
    "Alberto · Círculo Millonario · SHOW · seguimiento mié 2 p.m.",
  );
  assert.match(formatDueLabel(due, "UTC", due), /hoy/i);
});
