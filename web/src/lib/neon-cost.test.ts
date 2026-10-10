import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import webpush from "web-push";
import type { PrismaClient } from "@prisma/client";
import { schemaProbeSql, ensureCrmTables, ensureFathomTables, ensureCoachTables, ensureWorkspaceTables } from "./prisma";
import { notifyDueAlerts } from "./web-push";
import { classifyRecentlyDone, rememberClassifyDone, pushQuietHours, CLASSIFY_QUIET_MS } from "./db-quiet";

const src = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("schema probe: every table check + index count in one query", () => {
  const sql = schemaProbeSql(["A_idx", "B_idx"]);
  for (const piece of ["FathomConnection", "FathomRecording", "UserOffer", "ClientTranscript", "LeadAlert", "FollowupTouch", "CoachMessage", "pg_indexes", "'A_idx', 'B_idx'"]) {
    assert.ok(sql.includes(piece), piece);
  }
  assert.equal((sql.match(/SELECT/g) || []).length, 9);
});

test("ensure*: one probe query per instance when the tables are there", async () => {
  let calls = 0;
  const fake = {
    $queryRawUnsafe: async () => {
      calls += 1;
      return [{ idx: 999 }];
    },
    $executeRawUnsafe: async () => {
      throw new Error("no DDL expected");
    },
  } as unknown as PrismaClient;
  await ensureCrmTables(fake);
  await ensureFathomTables(fake);
  await ensureCoachTables(fake);
  await ensureWorkspaceTables(fake);
  await ensureCrmTables(fake);
  assert.equal(calls, 1);
});

function countingPrisma(subs: unknown[] = []) {
  const log: string[] = [];
  const prisma = {
    pushSubscription: { findMany: async () => (log.push("subs"), subs) },
    leadAlert: { findMany: async (args: { where: { userId: { in: string[] } } }) => (log.push(`alerts:${args.where.userId.in.join(",")}`), []) },
  } as unknown as PrismaClient;
  return { prisma, log };
}

test("push job: no push keys → no database at all", async () => {
  const keep = { ...process.env };
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  const { prisma, log } = countingPrisma();
  assert.deepEqual(await notifyDueAlerts(prisma), { due: 0, pushed: 0 });
  assert.deepEqual(log, []);
  process.env = keep;
});

test("push job: keys but no phone connected → one small query, no alert scan", async () => {
  const keep = { ...process.env };
  const keys = webpush.generateVAPIDKeys();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  const empty = countingPrisma();
  await notifyDueAlerts(empty.prisma);
  assert.deepEqual(empty.log, ["subs"]);
  const some = countingPrisma([{ id: "s1", userId: "u1", endpoint: "x", p256dh: "y", auth: "z" }]);
  await notifyDueAlerts(some.prisma);
  assert.deepEqual(some.log, ["subs", "alerts:u1"]);
  process.env = keep;
});

test("push quiet hours 22:00–07:00 Bogotá", () => {
  assert.equal(pushQuietHours(new Date("2026-10-10T04:00:00Z")), true); // 23:00
  assert.equal(pushQuietHours(new Date("2026-10-10T11:30:00Z")), true); // 06:30
  assert.equal(pushQuietHours(new Date("2026-10-10T12:00:00Z")), false); // 07:00
  assert.equal(pushQuietHours(new Date("2026-10-10T02:59:00Z")), false); // 21:59
});

test("crons: quiet/no-keys answer before touching the database", () => {
  const due = src("../app/api/cron/push-due/route.ts");
  assert.ok(due.indexOf("pushQuietHours") < due.indexOf("getPrisma()"));
  assert.ok(due.indexOf("pushConfigured()") < due.indexOf("getPrisma()"));
  const digest = src("../app/api/cron/alert-digest/route.ts");
  assert.ok(digest.indexOf("pushQuietHours") < digest.indexOf("getPrisma()"));
});

test("Llamadas: auto-filing is not re-asked on every visit", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(classifyRecentlyDone(storage, 1000, "a,b"), false);
  rememberClassifyDone(storage, 1000, "a,b");
  assert.equal(classifyRecentlyDone(storage, 1000 + 60_000, "a,b"), true);
  assert.equal(classifyRecentlyDone(storage, 1000 + 60_000, "a,b,c"), false, "a new call asks again");
  assert.equal(classifyRecentlyDone(storage, 1000 + CLASSIFY_QUIET_MS + 1, "a,b"), false);
  assert.equal(classifyRecentlyDone(null, 1000), false);
  const page = src("../app/llamadas/page.tsx");
  assert.ok(page.includes("classifyRecentlyDone(window.sessionStorage"));
});

test("Llamadas API: no full transcripts in the list or the auto-filing scan", () => {
  const route = src("../app/api/llamadas/route.ts");
  assert.ok(!/transcriptText:\s*true,\s*\n\s*practiceSessionId/.test(route));
  assert.ok(route.includes('left("transcriptText", 800)'));
  assert.ok(route.includes('right("transcriptText", 5000)'));
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.ok(!get.includes("clientTranscript.findMany"));
  const post = route.slice(route.indexOf("export async function POST"));
  assert.ok(!/take: 30,\s*select: \{[^}]*transcriptText: true/.test(post));
});
