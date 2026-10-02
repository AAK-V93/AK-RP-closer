import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatPracticeTimings,
  isPracticeQaRequest,
  micHowToFix,
  practiceErrorTitle,
  practiceQaStorageAction,
} from "./practice-qa";

test("qa mode is only the query or the stored flag", () => {
  assert.equal(isPracticeQaRequest("", null), false);
  assert.equal(isPracticeQaRequest("?qa=1", null), true);
  assert.equal(isPracticeQaRequest("", "1"), true);
  assert.equal(isPracticeQaRequest("?otro=1", null), false);
  assert.equal(isPracticeQaRequest("?qa=0", "1"), false);
  assert.equal(practiceQaStorageAction("?qa=1"), "set");
  assert.equal(practiceQaStorageAction("?qa=0"), "clear");
  assert.equal(practiceQaStorageAction(""), null);
});

test("a missing microphone is not a connection error", () => {
  assert.equal(practiceErrorTitle("mic"), "Falta el micrófono");
  assert.match(micHowToFix(), /micrófono/);
  assert.equal(practiceErrorTitle("connection"), "Error de conexión");
});

test("stage timings are readable in the badge", () => {
  assert.equal(
    formatPracticeTimings([
      { stage: "preparing", ms: 1200 },
      { stage: "audio", ms: 3400 },
    ]),
    "preparar 1.2s · audio 3.4s",
  );
});
