import assert from "node:assert/strict";
import { test } from "node:test";
import { isNonSalesCall } from "./call-kind";
import { emptyExtractor, extractorGap, extractorOneLiner } from "./extractor";
import { isReplayableResult } from "./replay-call";

test("isNonSalesCall catches coaching and non-sales labels", () => {
  assert.equal(isNonSalesCall("INTERNA"), true);
  assert.equal(isNonSalesCall("interna"), true);
  assert.equal(isNonSalesCall("NO_COMERCIAL"), true);
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
