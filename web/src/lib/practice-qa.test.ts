import assert from "node:assert/strict";
import { test } from "node:test";
import { isHardwareMicTrack } from "./practice-audio";
import {
  bindPracticeLeaveLogs,
  filterPracticeLeaveLogger,
  guardPracticeRoom,
  isPracticeLeaveNoise,
  isUserPracticeDisconnect,
  leavePracticeRoom,
  markPracticeLeaving,
  resetPracticeRoom,
} from "./practice-room";
import { practiceWarmMetadata, practiceWarmRoomName } from "./practice-dispatch";
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

test("cancel while connecting drops the mismatch warning and keeps a live one", async () => {
  const warnings: string[] = [];
  let cleared = 0;
  const room = {
    state: "connected",
    clearConnectionReconcile() {
      cleared += 1;
    },
    log: {
      warn: (message: string) => warnings.push(message),
    },
    localParticipant: {
      trackPublications: new Map(),
      unpublishTrack: async () => undefined,
    },
    disconnect: async () => {
      room.log.warn("detected connection state mismatch");
      room.log.warn("websocket closed");
      room.log.warn("WebSocket is closed before the connection is established");
    },
  };
  guardPracticeRoom(room as never);
  room.log.warn("detected connection state mismatch");
  assert.deepEqual(warnings, ["detected connection state mismatch"]);
  await room.disconnect(true);
  assert.equal(cleared, 1);
  assert.deepEqual(warnings, ["detected connection state mismatch"]);
  room.log.warn("other");
  assert.deepEqual(warnings, ["detected connection state mismatch", "other"]);
  assert.equal(isPracticeLeaveNoise("detected connection state mismatch"), true);
  resetPracticeRoom(room);
  room.log.warn("detected connection state mismatch");
  assert.equal(warnings.at(-1), "detected connection state mismatch");
});

test("an intentional leave silences the signal logger and a new call restores it", () => {
  const levels: string[] = [];
  bindPracticeLeaveLogs(
    () => levels.push("silent"),
    () => levels.push("info"),
  );
  const room = { clearConnectionReconcile() {} };
  markPracticeLeaving(room);
  resetPracticeRoom(room);
  assert.deepEqual(levels, ["silent", "info"]);
});

test("websocket closed stays quiet after the signal logger is rebuilt", async () => {
  const lines: string[] = [];
  const logger: {
    __level: number;
    getLevel: () => number;
    setLevel: (level: unknown, persist?: boolean) => void;
    methodFactory: (methodName: string, level: number, loggerName?: string) => (msg: string) => void;
    warn: (msg: string) => void;
  } = {
    __level: 2,
    getLevel() {
      return this.__level;
    },
    setLevel(level: unknown) {
      this.__level = level === "silent" || level === 5 ? 5 : 2;
      this.warn = this.methodFactory("warn", this.__level, "livekit-signal");
    },
    methodFactory() {
      return (msg: string) => {
        lines.push(msg);
      };
    },
    warn(msg: string) {
      lines.push(msg);
    },
  };
  const room = {
    state: "connecting",
    engine: { client: { log: logger }, log: logger },
    log: { warn: (message: string) => lines.push(`room:${message}`) },
    localParticipant: {
      trackPublications: new Map(),
      unpublishTrack: async () => undefined,
    },
    disconnect: async () => {
      lines.push("disconnect from room");
      logger.setLevel("info", false);
      logger.warn("websocket closed");
      logger.warn("signal dropped");
    },
  };
  guardPracticeRoom(room as never);
  filterPracticeLeaveLogger(logger);
  logger.warn("websocket closed");
  assert.deepEqual(lines, ["websocket closed"]);
  await room.disconnect(true);
  assert.deepEqual(lines, ["websocket closed", "disconnect from room", "signal dropped"]);
  resetPracticeRoom(room);
  logger.setLevel("info", false);
  logger.warn("websocket closed");
  assert.equal(lines.at(-1), "websocket closed");
});

test("two connects with the same url and token share one attempt", async () => {
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const room = {
    localParticipant: {
      trackPublications: new Map(),
      unpublishTrack: async () => undefined,
    },
    connect: async () => {
      calls += 1;
      await gate;
      return "ok";
    },
    disconnect: async () => undefined,
  };
  guardPracticeRoom(room as never);
  const first = room.connect("wss://livekit.example", "token");
  const second = room.connect("wss://livekit.example", "token");
  assert.equal(calls, 1);
  assert.equal(first, second);
  release();
  assert.equal(await first, "ok");
  assert.equal(await second, "ok");
});

test("a same-turn reconnect does not close the socket", async () => {
  const log: string[] = [];
  const room = {
    localParticipant: {
      trackPublications: new Map(),
      unpublishTrack: async () => undefined,
    },
    connect: async () => {
      log.push("connect");
    },
    disconnect: async () => {
      log.push("disconnect");
    },
  };
  guardPracticeRoom(room as never);
  const leaving = room.disconnect();
  const joining = room.connect("wss://livekit.example", "token");
  await Promise.all([leaving, joining]);
  assert.deepEqual(log, ["connect"]);
});

test("the page-load warm room is not a practice dispatch", () => {
  assert.equal(practiceWarmMetadata(), '{"warm":true}');
  assert.equal(practiceWarmRoomName("user-1", 60_000), "warm-user1-1");
  assert.match(practiceWarmRoomName("abc", 0), /^warm-abc-0$/);
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
    "micrófono 0.2s · acceso 0.4s · sala 0.8s · agente 9.0s · voz 5.0s",
  );
});
