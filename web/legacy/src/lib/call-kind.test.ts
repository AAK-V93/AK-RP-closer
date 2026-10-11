import assert from "node:assert/strict";
import { test } from "node:test";
import { agendaFromCloserWords, isNonSalesCall } from "./call-kind";
import { emptyExtractor, extractorGap, extractorOneLiner } from "./extractor";
import { isReplayableResult } from "./replay-call";

test("spanish attendance chips map to the agenda the CRM already stores", () => {
  assert.equal(agendaFromCloserWords("Asistió"), "SHOW");
  assert.equal(agendaFromCloserWords("No asistió"), "NO SHOW");
  assert.equal(agendaFromCloserWords("Reprogramó"), "REPROGRAMA");
  assert.equal(agendaFromCloserWords("Acordó sin pago"), "ACUERDO SIN PAGO");
  assert.equal(agendaFromCloserWords("Cerró"), "CIERRE VENTA");
  assert.equal(agendaFromCloserWords("Pago"), "");
});

test("isNonSalesCall catches coaching and non-sales labels", () => {
  assert.equal(isNonSalesCall("INTERNA"), true);
  assert.equal(isNonSalesCall("interna"), true);
  assert.equal(isNonSalesCall("NO_COMERCIAL"), true);
  assert.equal(isNonSalesCall("NO ES COMERCIAL"), true);
  assert.equal(isNonSalesCall("SHOW"), false);
  assert.equal(isNonSalesCall("CIERRE VENTA"), false);
});

test("extractor does not ask the hub about internal practice calls", () => {
  const parsed = emptyExtractor();
  parsed.estado_agenda = "INTERNA";
  parsed.confianza.estado_agenda = 95;
  parsed.requiere_seguimiento = false;
  assert.equal(extractorGap(parsed, true), null);
  assert.match(extractorOneLiner(parsed), /interna/i);
});

test("internal calls are not replayable as a prospect", () => {
  assert.equal(isReplayableResult("", "INTERNA"), false);
  assert.equal(isReplayableResult("no_cerro", "SHOW"), true);
});

test("missing follow-up date is a specific hub question, not a generic revision", () => {
  const parsed = emptyExtractor();
  parsed.cliente_real = "Ana";
  parsed.estado_agenda = "SHOW";
  parsed.confianza.cliente_real = 95;
  parsed.confianza.estado_agenda = 95;
  parsed.requiere_seguimiento = true;
  parsed.tipo_seguimiento = "DECISION";
  parsed.proximo_seguimiento = null;
  parsed.requiere_revision_humana = true;
  parsed.motivo_revision = "Hace falta confirmar un dato";
  const gap = extractorGap(parsed, true);
  assert.equal(gap?.field, "proximo_seguimiento");
  assert.match(gap?.question || "", /cuándo/i);
});

test("a named lead gets follow-up chips, and attendance stays chips too", () => {
  const follow = emptyExtractor();
  follow.cliente_real = "Dennis Sanchez Solorzano";
  follow.estado_agenda = "SHOW";
  follow.confianza.estado_agenda = 95;
  follow.requiere_seguimiento = null;
  const gap = extractorGap(follow, true);
  assert.equal(gap?.field, "tipo_seguimiento");
  assert.deepEqual(gap?.options, ["Segunda reunión", "Pago", "Decisión", "Retomar", "No quedó"]);
  assert.match(gap?.question || "", /Dennis Sanchez Solorzano/);

  const loose = emptyExtractor();
  loose.cliente_real = "Yajaira";
  loose.estado_agenda = "SHOW";
  loose.confianza.estado_agenda = 95;
  loose.requiere_seguimiento = false;
  loose.requiere_revision_humana = true;
  loose.motivo_revision = "Hace falta confirmar un dato";
  const yajaira = extractorGap(loose, true);
  assert.equal(yajaira?.field, "tipo_seguimiento");
  assert.ok(yajaira?.options?.includes("Retomar"));
  assert.ok(yajaira?.options?.includes("No quedó"));

  const agenda = emptyExtractor();
  agenda.cliente_real = "Ana";
  agenda.requiere_seguimiento = false;
  const states = extractorGap(agenda, true);
  assert.equal(states?.field, "estado_agenda");
  assert.ok(states?.options?.includes("Asistió"));
  assert.ok(states?.options?.includes("Cerró"));
});

test("a classified lead with a follow-up still open gets No quedó with the kind chips", () => {
  const parsed = emptyExtractor();
  parsed.cliente_real = "Katerine Rodríguez";
  parsed.estado_agenda = "SHOW";
  parsed.confianza.estado_agenda = 95;
  parsed.requiere_seguimiento = true;
  parsed.tipo_seguimiento = null;
  const gap = extractorGap(parsed, true);
  assert.equal(gap?.field, "tipo_seguimiento");
  assert.deepEqual(gap?.options, ["Segunda reunión", "Pago", "Decisión", "Retomar", "No quedó"]);
  assert.match(gap?.question || "", /Katerine Rodríguez/);
});
