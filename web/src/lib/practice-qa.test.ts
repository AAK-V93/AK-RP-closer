import assert from "node:assert/strict";
import { test } from "node:test";
import { leavePracticeRoom, resetPracticeRoom } from "./practice-room";
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

test("leaving a practice room unpublishes local tracks before disconnect", async () => {
  const stopped: string[] = [];
  const unpublished: string[] = [];
  let disconnects = 0;
  const track = { stop: () => stopped.push("mic") };
  const room = {
    localParticipant: {
      trackPublications: new Map([["mic", { track }]]),
      unpublishTrack: async (local: { stop?: () => void }) => {
        unpublished.push("mic");
        assert.equal(local, track);
      },
    },
    disconnect: async () => {
      if (disconnects === 0) assert.equal(unpublished.length, 1);
      disconnects += 1;
    },
  };
  const first = leavePracticeRoom(room);
  const second = leavePracticeRoom(room);
  assert.equal(first, second);
  await first;
  assert.deepEqual(stopped, ["mic"]);
  assert.equal(disconnects, 1);
  resetPracticeRoom(room);
  await leavePracticeRoom(room);
  assert.equal(disconnects, 2);
});

test("stage timings are readable in the badge", () => {
  assert.equal(
    formatPracticeTimings([
      { stage: "preparing", ms: 0 },
      { stage: "audio", ms: 1200 },
      { stage: "agente", ms: 32000 },
    ]),
    "preparar 0.0s · audio 1.2s · agente 32.0s",
  );
});
