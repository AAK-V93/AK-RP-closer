import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { CRM_CACHE_TTL_MS, cachedCrmRead, forgetCrmReads } from "./crm-read-cache";
import { DURATION_MINUTES_SQL, TAG_FILING_SQL, filingObject, filingSubsetSql, usableTranscriptSql } from "./call-list-sql";
import { recordingTextFacts, rememberRecordingTextFacts } from "./recording-ficha";

const src = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function fingerprintDb() {
  const state = { fp: "1:100", reads: 0, fail: false };
  const prisma = {
    $queryRaw: async () => {
      state.reads += 1;
      if (state.fail) throw new Error("cold neon");
      return [{ fp: state.fp }];
    },
  };
  return { state, prisma: prisma as unknown as PrismaClient };
}

test("CRM read cache: same data → reused; any write (new fingerprint) → recomputed", async () => {
  const { state, prisma } = fingerprintDb();
  forgetCrmReads("u-cache");
  let computes = 0;
  const compute = async () => ({ n: ++computes, at: new Date("2026-10-10T15:00:00Z") });
  const now = new Date("2026-10-11T15:00:00Z");
  const a = await cachedCrmRead(prisma, "u-cache", "k", compute, now);
  const b = await cachedCrmRead(prisma, "u-cache", "k", compute, new Date(now.getTime() + 60_000));
  assert.equal(a.n, 1);
  assert.equal(b.n, 1);
  assert.ok(b.at instanceof Date); // a clone, dates kept
  b.n = 99; // callers can't mutate the cached copy
  assert.equal((await cachedCrmRead(prisma, "u-cache", "k", compute, now)).n, 1);
  state.fp = "2:140"; // «Guardar» wrote a row
  assert.equal((await cachedCrmRead(prisma, "u-cache", "k", compute, now)).n, 2);
  // Other keys and users don't share entries.
  assert.equal((await cachedCrmRead(prisma, "u-other", "k", compute, now)).n, 3);
});

test("CRM read cache: TTL and day change recompute; a failed fingerprint just computes", async () => {
  const { state, prisma } = fingerprintDb();
  forgetCrmReads("u-ttl");
  let computes = 0;
  const compute = async () => ++computes;
  const now = new Date("2026-10-11T15:00:00Z");
  assert.equal(await cachedCrmRead(prisma, "u-ttl", "k", compute, now), 1);
  assert.equal(await cachedCrmRead(prisma, "u-ttl", "k", compute, new Date(now.getTime() + CRM_CACHE_TTL_MS + 1)), 2);
  // 23:59 → 00:01 Bogotá: a new day ("vence hoy") recomputes.
  const late = new Date("2026-10-12T04:59:00Z");
  assert.equal(await cachedCrmRead(prisma, "u-ttl", "d", compute, late), 3);
  assert.equal(await cachedCrmRead(prisma, "u-ttl", "d", compute, new Date("2026-10-12T05:01:00Z")), 4);
  const orig = console.error;
  console.error = () => undefined;
  try {
    state.fail = true;
    assert.equal(await cachedCrmRead(prisma, "u-ttl", "k", compute, now), 5);
    assert.equal(await cachedCrmRead(prisma, "u-ttl", "k", compute, now), 6);
  } finally {
    console.error = orig;
  }
  forgetCrmReads("u-ttl");
  state.fail = false;
  assert.equal(await cachedCrmRead(prisma, "u-ttl", "k", compute, now), 7);
});

test("CRM read cache fingerprint covers every table the cached reads use", () => {
  const cache = src("./crm-read-cache.ts");
  for (const table of [
    "CallRecord", "Lead", "LeadAlert", "Commission", "FollowupThread", "FollowupTouch",
    "UserOffer", "CoachMessage", "User", "FollowupLibraryScript", "FollowupPack", "PracticeSession",
  ]) {
    assert.ok(cache.includes(`FROM "${table}"`), table);
  }
  assert.match(src("./crm-metrics.ts"), /cachedCrmRead\(prisma, userId, `dashboard:/);
  assert.match(src("./person-load.ts"), /cachedCrmRead/);
  assert.match(src("./hub-crm-chat.ts"), /"chat-money"/);
  assert.match(src("./call-intelligence.ts"), /"pending-filings"/);
});

test("SQL pieces: duration and usable checks run in Postgres, filing subsets keep only named keys", () => {
  assert.match(DURATION_MINUTES_SQL.text, /regexp_matches/);
  assert.match(DURATION_MINUTES_SQL.text, /left\("transcriptText", 800\)/);
  assert.match(DURATION_MINUTES_SQL.text, /right\("transcriptText", 5000\)/);
  const usable = usableTranscriptSql("[sin transcripción]");
  assert.match(usable.text, />= 80/);
  assert.deepEqual(usable.values, ["[sin transcripción]"]);
  const subset = filingSubsetSql(["lead_id", "cliente_real"], { evidencia: ["cierre"] });
  assert.match(subset.text, /jsonb_each/);
  assert.ok(subset.values.includes("lead_id"));
  assert.ok(subset.values.includes("cierre"));
  assert.ok(TAG_FILING_SQL.values.includes("notas_crm"));
  assert.deepEqual(filingObject('{"a":1}'), { a: 1 });
  assert.deepEqual(filingObject({ b: 2 }), { b: 2 });
  assert.deepEqual(filingObject(null), {});
  assert.deepEqual(filingObject("not json"), {});
});

test("list routes never ship transcript text", () => {
  const llamadas = src("../app/api/llamadas/route.ts");
  const get = llamadas.slice(llamadas.indexOf("export async function GET"), llamadas.indexOf("export async function POST"));
  assert.ok(!/SELECT[^`]*"transcriptText"\s*(,|AS|FROM)/.test(get));
  assert.match(get, /LIMIT \$\{LLAMADAS_LIST_LIMIT\}/);
  assert.match(get, /"sourceId" IN/);
  const recordings = src("../app/api/fathom/recordings/route.ts");
  assert.ok(!/transcriptText:\s*true/.test(recordings));
  assert.match(recordings, /"hasTranscript"/);
  const replay = src("./replay-call.ts");
  const list = replay.slice(replay.indexOf("export async function listReplayCalls"));
  assert.ok(!/transcriptText:\s*true/.test(list.slice(0, 4000)));
  for (const file of ["../app/api/coach/route.ts", "./coach-service.ts"]) {
    const text = src(file);
    assert.ok(!/practiceSession\.findMany\([\s\S]{0,400}transcript:\s*true/.test(text), file);
  }
});

test("practice and workspace replies skip the transcript corpus and the full playbooks", () => {
  assert.match(src("../app/api/practice-calls/route.ts"), /corpus: false/);
  const workspace = src("./workspace.ts");
  assert.match(workspace, /activePlaybook/);
  assert.ok(!/userOffer\.findMany\(\{[^}]*\}[\s\S]{0,200}playbook: true/.test(workspace));
  assert.match(src("./live-guide.ts"), /'liveGuide'/);
});

test("old-call ficha: the transcript facts are remembered so it downloads once", () => {
  const now = 1_000_000;
  assert.equal(recordingTextFacts("rec-1", now), null);
  rememberRecordingTextFacts("rec-1", { usable: true, signal: false }, now);
  assert.deepEqual(recordingTextFacts("rec-1", now + 60_000), { usable: true, signal: false });
  assert.equal(recordingTextFacts("rec-1", now + 31 * 60_000), null);
  assert.match(src("./recording-ficha-load.ts"), /recordingTextFacts\(/);
});
