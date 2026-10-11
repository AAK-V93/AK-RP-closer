// CI guards for the never-do list (plan 2.7). They scan only web/src
// (legacy/ is out of the build). Each guard has a self-test so a broken
// regex cannot pass silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { REVALIDATE, tags, tagsForWrite, WRITE_EFFECTS, type WriteEffect } from "@/lib/read/tags";
import { invalidate } from "@/lib/write/invalidate";

const SRC = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const appFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

/** Removes // and /* *\/ comments (keeps strings), so docs do not trip the guards. */
function stripComments(code: string) {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Text of the argument list of each call `.name(` (balanced parentheses). */
function callArgs(code: string, names: string[]) {
  const out: Array<{ name: string; args: string; at: number }> = [];
  const re = new RegExp(`\\.(${names.join("|")})\\s*\\(`, "g");
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < code.length && depth > 0) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") depth -= 1;
      i += 1;
    }
    out.push({ name: m[1], args: code.slice(start, i - 1), at: code.slice(0, m.index).split("\n").length });
  }
  return out;
}

// ---------- (b) every DB read has select (+ take for lists) ----------

const READS = ["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "groupBy"];

function readViolations(code: string) {
  const bad: string[] = [];
  for (const call of callArgs(stripComments(code), READS)) {
    if (/\binclude\s*:/.test(call.args)) bad.push(`${call.name} uses include (line ${call.at})`);
    if (call.name !== "groupBy" && !/\bselect\s*:/.test(call.args)) bad.push(`${call.name} without select (line ${call.at})`);
    if ((call.name === "findMany" || call.name === "groupBy") && !/\btake\s*:/.test(call.args)) {
      bad.push(`${call.name} without take (line ${call.at})`);
    }
  }
  return bad;
}

test("guard (b) catches unbounded reads", () => {
  assert.equal(readViolations(`db.lead.findMany({ where: { userId } })`).length, 2);
  assert.equal(readViolations(`db.lead.findMany({ where, select: { id: true } })`).length, 1);
  assert.equal(readViolations(`db.call.findUnique({ where: { id } })`).length, 1);
  assert.equal(readViolations(`db.call.findFirst({ where, include: { lead: true } })`).length, 2);
  assert.equal(readViolations(`db.x.findMany({ where: f(a), take: 5, select: PERSON_ROW_SELECT })`).length, 0);
  // a comment mentioning findMany is not a call
  assert.equal(readViolations(`// never findMany({}) here`).length, 0);
});

test("(b) every DB read in web/src has select, and lists have take", () => {
  const bad = appFiles.flatMap((f) => readViolations(readFileSync(f, "utf8")).map((v) => `${rel(f)}: ${v}`));
  assert.deepEqual(bad, []);
});

test("(b) no count() for tabs or banner, raw SQL only where allowed", () => {
  const bad: string[] = [];
  for (const f of appFiles) {
    const code = stripComments(readFileSync(f, "utf8"));
    const r = rel(f);
    if (/\.(count|aggregate)\s*\(/.test(code)) bad.push(`${r}: count()/aggregate() (read UserCounters/UserMonthStats)`);
    if (/\$queryRaw/.test(code) && r !== "app/api/health/db/route.ts") bad.push(`${r}: $queryRaw`);
    if (/\$executeRaw/.test(code) && !r.startsWith("lib/write/")) bad.push(`${r}: $executeRaw outside lib/write`);
    if (/\$transaction|updateMany|deleteMany|createMany/.test(code)) bad.push(`${r}: needs a transaction on Neon HTTP`);
    if (/\b(transcript|summaryEn)\s*:\s*true/.test(code) && !r.startsWith("lib/write/")) bad.push(`${r}: selects transcript/summaryEn`);
  }
  assert.deepEqual(bad, []);
});

test("(b) lists never select brief", () => {
  const code = stripComments(readFileSync(path.join(SRC, "lib/read/pending.ts"), "utf8")) +
    stripComments(readFileSync(path.join(SRC, "lib/read/today.ts"), "utf8")) +
    stripComments(readFileSync(path.join(SRC, "lib/read/people.ts"), "utf8"));
  assert.doesNotMatch(code, /\bbrief\s*:\s*true/);
});

// ---------- (c) metrics are computed only in lib/metrics ----------

const METRIC_FIELDS = [
  "callsHeld", "closedCount", "lostCount", "attemptsCount", "salesTotal", "cashCollected",
  "commissionEarned", "commissionAmount", "commissionValue", "amountTotal", "priceCash",
  "potentialCommission", "followingCount", "pendingConfirmCount", "callsSinceLastClose",
  "attemptsSinceLastCall", "topObjectionHits", "topObjectionOf", "targetCommission",
].join("|");
const FIELD = `(?:\\w+(?:\\?\\.|\\.))*\\b(?:${METRIC_FIELDS})\\b`;
const ARITH = new RegExp(`${FIELD}\\s*[-+*/%](?![-+=/*])|[-+*/%]=?\\s*${FIELD}|Math\\.\\w+\\([^)]*${FIELD}`);

function metricViolations(code: string) {
  return stripComments(code)
    .split("\n")
    .map((line, i) => (ARITH.test(line) ? `line ${i + 1}: ${line.trim()}` : null))
    .filter((v): v is string => v !== null);
}

test("guard (c) catches a screen doing its own math", () => {
  assert.equal(metricViolations(`const total = stats.closedCount + stats.lostCount;`).length, 1);
  assert.equal(metricViolations(`const rate = won / s.closedCount`).length, 1);
  assert.equal(metricViolations(`left = goal - stats?.commissionEarned`).length, 1);
  assert.equal(metricViolations(`const n = Math.round(row.callsHeld / 2)`).length, 1);
  assert.equal(metricViolations(`const p = peopleTabs(counters, stats); // closedCount + lostCount`).length, 0);
  assert.equal(metricViolations(`select: { closedCount: true, lostCount: true }`).length, 0);
});

test("(c) no screen or route computes a metric outside lib/metrics", () => {
  const allowed = (r: string) => r.startsWith("lib/metrics/") || r.startsWith("lib/write/");
  const bad = appFiles
    .filter((f) => !allowed(rel(f)))
    .flatMap((f) => metricViolations(readFileSync(f, "utf8")).map((v) => `${rel(f)} ${v}`));
  assert.deepEqual(bad, []);
});

// ---------- cache tags ----------

test("tags are per user and writes invalidate the right ones", () => {
  assert.equal(tags.lead("u1", "l1"), "u:u1:lead:l1");
  assert.deepEqual(tagsForWrite("u1", WRITE_EFFECTS.confirmCall("l1")).sort(), [
    "u:u1:lead:l1", "u:u1:leads", "u:u1:pending", "u:u1:stats",
  ]);
  assert.deepEqual(tagsForWrite("u1", WRITE_EFFECTS.logAttempt("l1")).sort(), ["u:u1:lead:l1", "u:u1:leads", "u:u1:stats"]);
  assert.deepEqual(tagsForWrite("u1", WRITE_EFFECTS.setGoal()), ["u:u1:goal"]);
  const seen: string[] = [];
  invalidate("u2", WRITE_EFFECTS.upsertOffer(), (t) => seen.push(t));
  assert.deepEqual(seen.sort(), ["u:u2:goal", "u:u2:leads", "u:u2:offers"]); // commission moves potentialCommission
});

test("every cached reader is tagged per user and uses a lib/read reader", () => {
  const code = stripComments(readFileSync(path.join(SRC, "lib/read/cached.ts"), "utf8"));
  const wrappers = [...code.matchAll(/cachedRead\(\s*("[\w-]+"[\s\S]*?)\n\s*\);?\n/g)].map((m) => m[1]);
  assert.ok(wrappers.length >= 11, `found ${wrappers.length}`);
  for (const w of wrappers) {
    assert.match(w, /tags: \[tags\.\w+\(userId/);
    assert.match(w, /revalidate: REVALIDATE\.(today|safety)/);
    assert.match(w, /^"[\w-]+",\s*\[userId/); // key includes userId
  }
});

test("D: every read that depends on «hoy» has the Bogotá day in its key and 600 s", () => {
  const code = stripComments(readFileSync(path.join(SRC, "lib/read/cached.ts"), "utf8"));
  const wrappers = [...code.matchAll(/export const (\w+) = \(([^)]*)\) =>\s*cachedRead\(([\s\S]*?)\n\s*\);?\n/g)];
  // readers whose result changes with the date (today list, month header)
  const todayReaders = ["readTodayList", "readTodayHeader"];
  let checked = 0;
  for (const [, name, params, body] of wrappers) {
    if (!todayReaders.some((r) => body.includes(r))) continue;
    checked += 1;
    assert.match(params, /today: DayKey/, `${name} takes today`);
    assert.match(body, /\[userId, today\b/, `${name} keys by today`);
    assert.match(body, /REVALIDATE\.today/, `${name} expires in 600 s`);
  }
  assert.equal(checked, 2);
  assert.equal(REVALIDATE.today, 600);
  // and the today list never asks the server clock
  const today = stripComments(readFileSync(path.join(SRC, "lib/read/today.ts"), "utf8"));
  assert.doesNotMatch(today, /new Date\(\)|Date\.now\(\)/);
});

test("E: cache hits are logged in previews", () => {
  const code = readFileSync(path.join(SRC, "lib/read/cached.ts"), "utf8");
  assert.match(code, /VERCEL_ENV === "preview"/);
  assert.match(code, /\[cache\] \$\{name\} \$\{missed \? "miss" : "hit"\}/);
});

// ---------- D: every write invalidates what WRITE_EFFECTS says ----------

/** Exported functions in lib/write that are helpers, not write points. */
const WRITE_HELPERS = new Set([
  "invalidate", "createUserCounters", "toOneLine", "parseAmount", "validateOffer",
  "recount", "recountLeadAttempts", "recountMonthAll", "recountMonthOffer", "recountCounters",
]);

function writeFunctions(code: string) {
  const clean = stripComments(code);
  const out: Array<{ name: string; body: string }> = [];
  const re = /^export (?:async )?function (\w+)/gm;
  const starts = [...clean.matchAll(re)];
  starts.forEach((m, i) => {
    const end = starts[i + 1]?.index ?? clean.length;
    out.push({ name: m[1], body: clean.slice(m.index, end) });
  });
  return out;
}

function writeViolations(code: string, effects: Record<string, unknown>) {
  const bad: string[] = [];
  for (const fn of writeFunctions(code)) {
    if (WRITE_HELPERS.has(fn.name)) continue;
    if (!(fn.name in effects)) bad.push(`${fn.name}: no WRITE_EFFECTS.${fn.name}`);
    else if (!new RegExp(`invalidate\\(userId, WRITE_EFFECTS\\.${fn.name}\\(`).test(fn.body)) {
      bad.push(`${fn.name}: does not call invalidate(userId, WRITE_EFFECTS.${fn.name}(…))`);
    }
  }
  return bad;
}

test("guard D catches a write that forgets its tags", () => {
  const effects = { saveThing: 1 };
  assert.deepEqual(writeViolations(`export async function saveThing(db, userId) { await db.x.update(); }`, effects), [
    "saveThing: does not call invalidate(userId, WRITE_EFFECTS.saveThing(…))",
  ]);
  assert.deepEqual(writeViolations(`export async function other(db, userId) { invalidate(userId, WRITE_EFFECTS.saveThing()); }`, effects), [
    "other: no WRITE_EFFECTS.other",
  ]);
  assert.deepEqual(writeViolations(`export async function saveThing(db, userId) { invalidate(userId, WRITE_EFFECTS.saveThing(), r); }`, effects), []);
});

test("D: every write function in lib/write calls the revalidateTag set of WRITE_EFFECTS", () => {
  const files = walk(path.join(SRC, "lib/write")).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
  const bad = files.flatMap((f) => writeViolations(readFileSync(f, "utf8"), WRITE_EFFECTS).map((v) => `${rel(f)} ${v}`));
  assert.deepEqual(bad, []);
  // and every WRITE_EFFECTS entry yields tags (no empty effect)
  for (const [name, fn] of Object.entries(WRITE_EFFECTS)) {
    assert.ok(tagsForWrite("u1", (fn as (a: string) => WriteEffect)("l1")).length > 0, name);
  }
});
