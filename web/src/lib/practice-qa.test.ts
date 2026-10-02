import assert from "node:assert/strict";
import { test } from "node:test";
import { isHardwareMicTrack } from "./practice-audio";
import {
  guardPracticeRoom,
  isUserPracticeDisconnect,
  leavePracticeRoom,
  resetPracticeRoom,
} from "./practice-room";
import {
  formatPracticeTimings,
  isPracticeQaRequest,
  micHowToFix,
  practiceClockParts,
  practiceConnectSpans,
  practiceErrorTitle,
  practiceQaStorageAction,
  sumPracticeTimings,
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
      trackPublications: new Map([["mic", { track, trackSid: "TR_mic" }]]),
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

test("a track without a publication is stopped and not unpublished", async () => {
  let unpublished = 0;
  const stopped: string[] = [];
  const offers: string[] = [];
  const room = {
    state: "connecting",
    engine: {
      isClosed: false,
      pcManager: {
        publisher: {
          _pc: { signalingState: "closed" },
          createAndSendOffer: async () => {
            offers.push("offer");
          },
        },
      },
    },
    localParticipant: {
      trackPublications: new Map([["mic", { track: { stop: () => stopped.push("mic") } }]]),
      unpublishTrack: async () => {
        unpublished += 1;
      },
    },
    disconnect: async () => undefined,
  };
  await leavePracticeRoom(room);
  assert.equal(unpublished, 0);
  assert.ok(stopped.includes("mic"));
  await room.engine.pcManager.publisher.createAndSendOffer();
  assert.deepEqual(offers, []);
});

test("disconnect does not unpublish a track that was never published", async () => {
  let originalUnpublish = 0;
  const warnings: string[] = [];
  const track = { stop() {} };
  const room = {
    state: "connecting",
    log: {
      warn: (message: string) => warnings.push(message),
    },
    localParticipant: {
      trackPublications: new Map([["pending", { track }]]),
      audioTrackPublications: new Map(),
      videoTrackPublications: new Map(),
      pendingPublishPromises: new Map([[track, Promise.resolve()]]),
      unpublishTrack: async () => {
        originalUnpublish += 1;
      },
    },
    connect: async () => {
      throw new Error("Client initiated disconnect");
    },
    disconnect: async function (this: {
      localParticipant: { trackPublications: Map<string, { track?: { stop?: () => void } }> };
    }) {
      for (const pub of this.localParticipant.trackPublications.values()) {
        if (pub.track) await room.localParticipant.unpublishTrack(pub.track, true);
      }
    },
  };
  guardPracticeRoom(room as never);
  await room.connect();
  await room.disconnect(true);
  assert.equal(originalUnpublish, 0);
  assert.equal(room.localParticipant.pendingPublishPromises.size, 0);
  assert.equal(warnings.length, 0);
  room.log.warn("Abort connection attempt due to user initiated disconnect");
  room.log.warn("other");
  assert.deepEqual(warnings, ["other"]);
  assert.equal(isUserPracticeDisconnect(new Error("Client initiated disconnect")), true);
});

test("the practice clock starts at the click and voz waits for audio", () => {
  const spans = practiceConnectSpans({
    clickAt: 0,
    micAt: 0,
    tokenAt: 120,
    roomAt: 640,
    agentAt: 640,
    voiceAt: 4200,
  });
  assert.equal(spans.stages.find((row) => row.stage === "agente")?.ms, 0);
  assert.equal(spans.stages.find((row) => row.stage === "voz")?.ms, 3560);
  assert.equal(spans.elapsedMs, 4200);
  assert.equal(sumPracticeTimings(spans.stages), 4200);
});

test("krisp stays off without a real microphone", () => {
  assert.equal(isHardwareMicTrack(null), false);
  assert.equal(isHardwareMicTrack({ label: "" }), false);
  assert.equal(isHardwareMicTrack({ getSettings: () => ({ deviceId: "mic-1" }) }), true);
});

test("conexión stops at remote audio and llamada is only the call", () => {
  const connecting = practiceClockParts({ clickAt: 1_000, now: 2_200, voiceAt: null });
  assert.equal(connecting.connectMs, 1_200);
  assert.equal(connecting.callMs, 0);
  assert.equal(connecting.live, false);
  const live = practiceClockParts({ clickAt: 1_000, now: 3_500, voiceAt: 2_200 });
  assert.equal(live.connectMs, 1_200);
  assert.equal(live.callMs, 1_300);
  assert.equal(live.live, true);
});

test("stage timings are readable in the badge", () => {
  assert.equal(
    formatPracticeTimings([
      { stage: "mic", ms: 200 },
      { stage: "token", ms: 400 },
      { stage: "sala", ms: 800 },
      { stage: "agente", ms: 9000 },
      { stage: "voz", ms: 5000 },
    ]),
    "mic 0.2s · token 0.4s · sala 0.8s · agente 9.0s · voz 5.0s",
  );
});
