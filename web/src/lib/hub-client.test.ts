import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  chatSendReady,
  createHubCache,
  hubChatPostBody,
  hubLoadRetry,
  type HubGet,
} from "./hub-client";

function fakeFetch(calls: string[]) {
  return async (input: string) => {
    calls.push(input);
    const data: HubGet = {
      messages: [{ id: "m", role: "coach", content: "hola" }],
      snapshot: { now: { oportunidadesActivas: 23 } },
    };
    return { ok: true, json: async () => data };
  };
}

test("parallel Inicio readers share one /api/hub call", async () => {
  let clock = 1_000;
  const cache = createHubCache(() => clock);
  const calls: string[] = [];
  const fetchImpl = fakeFetch(calls);
  const [first, second] = await Promise.all([
    cache.load(fetchImpl),
    cache.load(fetchImpl),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "/api/hub");
  assert.equal(first, second);
  clock += 1_000;
  await cache.load(fetchImpl);
  assert.equal(calls.length, 1);
});

test("a mutation can refresh once, and a remembered reply skips the GET", async () => {
  let clock = 5_000;
  const cache = createHubCache(() => clock);
  const calls: string[] = [];
  await cache.load(fakeFetch(calls));
  clock += 30_000;
  await cache.load(fakeFetch(calls), { force: true });
  assert.equal(calls.length, 2);
  cache.remember({ snapshot: { now: { oportunidadesActivas: 23 } }, messages: [] });
  clock += 1_000;
  const again = await cache.load(fakeFetch(calls));
  assert.equal(calls.length, 2);
  assert.equal(
    (again.snapshot as { now: { oportunidadesActivas: number } }).now.oportunidadesActivas,
    23,
  );
});

test("a failed hub read is not cached as an empty home", async () => {
  const cache = createHubCache(() => 1_000);
  const calls: string[] = [];
  await assert.rejects(() =>
    cache.load(async (input) => {
      calls.push(input);
      return {
        ok: false,
        json: async () => ({ error: "No se pudo cargar el inicio", snapshot: null, messages: [] }),
      };
    }),
  );
  assert.equal(calls.length, 1);
  await cache.load(fakeFetch(calls));
  assert.equal(calls.length, 2);
});

test("a failed hub load retries once before asking for a button", () => {
  assert.equal(hubLoadRetry({ attempt: 0, hasSnapshot: false }), "auto");
  assert.equal(hubLoadRetry({ attempt: 1, hasSnapshot: false }), "manual");
  assert.equal(hubLoadRetry({ attempt: 0, hasSnapshot: true }), "ready");
  const chat = readFileSync(new URL("../components/hub-chat.tsx", import.meta.url), "utf8");
  assert.match(chat, /HUB_RETRY_MS/);
  assert.match(chat, /Reintentar/);
  assert.match(chat, /inputsLocked \|\| recording/);
  assert.doesNotMatch(chat, /disabled=\{!canSend \|\| sending \|\| !draft/);
});

test("a remembered turn survives the next read inside the fresh window", async () => {
  let clock = 8_000;
  const cache = createHubCache(() => clock);
  const calls: string[] = [];
  await cache.load(fakeFetch(calls));
  cache.rememberLines([
    { id: "u", role: "user", content: "¿Qué tengo pendiente hoy?" },
    { id: "c", role: "coach", content: "Hoy tienes 0 para hoy, sin cobros pendientes." },
  ]);
  clock += 1_000;
  const again = await cache.load(fakeFetch(calls));
  assert.equal(calls.length, 1);
  const text = (again.messages || []).map((line) => line.content).join("\n");
  assert.match(text, /¿Qué tengo pendiente hoy\?/);
  assert.match(text, /sin cobros pendientes/);
});

test("the first chat message waits until the hub has loaded", () => {
  const pending = "¿Qué tengo pendiente hoy?";
  assert.equal(chatSendReady({ loading: true, hubResolved: false }), false);
  assert.equal(hubChatPostBody({ loading: true, hubResolved: false, text: pending }), null);
  assert.equal(hubChatPostBody({ loading: false, hubResolved: false, text: pending }), null);
  assert.deepEqual(hubChatPostBody({ loading: false, hubResolved: true, text: pending }), {
    message: pending,
  });
});
