// v2, PR 1: static checks on the clean schema and its baseline migration.
// Plan: closer-arquitectura/plan-tecnico-rediseno-v2-2026-10-11.md (1.1, 2.7, 3.2 PR 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(WEB, rel), "utf8");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/0_init/migration.sql");

function models(src: string) {
  return [...src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({
    name: m[1],
    body: m[2],
  }));
}

const PR1_MODELS = [
  "User",
  "FathomConnection",
  "Offer",
  "Script",
  "SuccessCase",
  "Lead",
  "Call",
  "CallTranscript",
  "CallObjection",
  "FollowUpTask",
  "LeadEvent",
  "ProposedChange",
  "UserMonthStats",
  "UserCounters",
  "PracticeSession",
  "PushSubscription",
];
// PR 3 (Mis ofertas): success-case sources and the Drive connection.
const PR3_MODELS = ["OfferCaseSource", "GoogleDriveConnection"];
// PR 4 (Metas)
const PR4_MODELS = ["MonthlyGoal", "WeeklyGoal"];

test("schema has exactly the PR 1 + PR 3 + PR 4 models", () => {
  assert.deepEqual(models(schema).map((m) => m.name).sort(), [...PR1_MODELS, ...PR3_MODELS, ...PR4_MODELS].sort());
});

test("old tables and later-PR tables are not in the schema", () => {
  const names = new Set(models(schema).map((m) => m.name));
  for (const old of [
    "CallRecord",
    "FathomRecording",
    "ClientTranscript",
    "LeadAlert",
    "FollowupThread",
    "FollowupTouch",
    "CommissionRule",
    "Commission",
    "FollowupPack",
    "FollowupStar",
    "FollowupLibraryScript",
    "ExtractorFeedback",
    "CoachProfile",
    "CoachMessage",
    "UserOffer",
    // their own PRs
    "Deal",
    "DealInstallment",
    "CoachInsight",
    "LeadMessageIdeas",
  ]) {
    assert.equal(names.has(old), false, old);
  }
  assert.equal(/filingJson|crmPrefs|transcriptJson|amountTalked|amountPaid/.test(schema), false);
});

test("every table has userId (CallTranscript and SuccessCase included)", () => {
  for (const m of models(schema)) {
    if (m.name === "User") continue;
    assert.match(m.body, /^\s+userId\s+String/m, m.name);
  }
});

test("every index starts with userId or leadId", () => {
  for (const m of models(schema)) {
    for (const idx of m.body.matchAll(/@@(?:index|unique)\(\[(\w+)/g)) {
      const first = idx[1];
      // Plan 1.1 asks for webhookToken @index explicitly (webhook lookup by token).
      if (m.name === "FathomConnection" && first === "webhookToken") continue;
      // Arquitectura: Lead.lastCallId is a normal FK with its own index.
      if (m.name === "Lead" && first === "lastCallId") continue;
      // Success-case design: one row per (offer, source) and per (offer, case).
      if (m.name === "OfferCaseSource" && idx[0] === "@@unique([offerId") continue;
      if (m.name === "SuccessCase" && idx[0] === "@@unique([offerId") continue;
      assert.ok(first === "userId" || first === "leadId", `${m.name}: ${idx[0]}`);
    }
  }
});

test("money is Decimal(12,2) with currency, never Float", () => {
  const floats = [...schema.matchAll(/^\s+(\w+)\s+Float/gm)].map((m) => m[1]);
  assert.deepEqual(floats, ["overallScore"]); // practice score, not money
  for (const field of [
    "priceCash",
    "installmentAmount",
    "commissionValue",
    "potentialCommission",
    "salesTotal",
    "cashCollected",
    "commissionEarned",
  ]) {
    assert.match(schema, new RegExp(`^\\s+${field}\\s+Decimal\\??\\s.*@db\\.Decimal\\(12, 2\\)`, "m"), field);
  }
  const body = (name: string) => models(schema).find((m) => m.name === name)!.body;
  const currency = /currency\s+String\s+@default\("USD"\)/;
  // Aggregates sum only in User.currency; other currencies stay "por confirmar".
  assert.match(body("User"), currency);
  assert.doesNotMatch(body("UserMonthStats"), /^\s+currency\s/m);
  assert.match(body("Offer"), currency);
  assert.match(body("Lead"), currency); // potentialCommission only
});

test("fields decided with Arquitectura", () => {
  const body = (name: string) => models(schema).find((m) => m.name === name)!.body;
  assert.match(body("Lead"), /^\s+lastCallId\s+String\?\s*$/m); // not unique
  assert.match(body("Lead"), /onDelete: SetNull/);
  assert.match(body("Lead"), /@@index\(\[lastCallId\]\)/);
  assert.match(body("FollowUpTask"), /^\s+dueDate\s+DateTime\s+@db\.Date/m);
  assert.match(body("FollowUpTask"), /^\s+dueAt\s+DateTime\?/m);
  // success-case design: what the app read vs what the person corrected
  for (const f of ["profile", "before", "result", "quote", "mediaUrl"]) {
    assert.match(body("SuccessCase"), new RegExp(`^\\s+${f}Extracted\\s+String\\?`, "m"), f);
    assert.match(body("SuccessCase"), new RegExp(`^\\s+${f}User\\s+String\\?`, "m"), f);
  }
  for (const f of ["externalKey\\s+String", "sourceSnippet\\s+String\\?", "confirmedAt\\s+DateTime\\?", "dismissed\\s+Boolean\\s+@default\\(false\\)", "missingFromSourceAt\\s+DateTime\\?"]) {
    assert.match(body("SuccessCase"), new RegExp(`^\\s+${f}`, "m"), f);
  }
  assert.match(body("SuccessCase"), /@@unique\(\[offerId, externalKey\]\)/);
  assert.match(body("OfferCaseSource"), /@@unique\(\[offerId, externalId\]\)/);
  assert.match(body("OfferCaseSource"), /^\s+contentHash\s+String\?/m);
  assert.match(body("Offer"), /commissionType\s+CommissionType\?/);
  assert.match(body("Call"), /briefVersion\s+Int\s+@default\(0\)/);
  assert.match(body("Call"), /oneLine\s+String\?\s+@db\.VarChar\(140\)/);
  assert.match(body("Lead"), /oneLine\s+String\?\s+@db\.VarChar\(140\)/);
});

test("statuses are Prisma enums, not free strings", () => {
  const field = (model: string, name: string) =>
    models(schema)
      .find((m) => m.name === model)!
      .body.match(new RegExp(`^\\s+${name}\\s+(\\w+)`, "m"))![1];
  assert.equal(field("Lead", "status"), "LeadStatus");
  assert.equal(field("Call", "state"), "CallState");
  assert.equal(field("Call", "source"), "CallSource");
  assert.equal(field("FollowUpTask", "status"), "TaskStatus");
  assert.equal(field("LeadEvent", "type"), "LeadEventType");
  assert.equal(field("ProposedChange", "status"), "ChangeStatus");
  assert.equal(field("FathomConnection", "backfillStatus"), "BackfillStatus");
});

test("0_init + 1_ofertas + 2_metas, and 0_init carries the two partial unique indexes", () => {
  const dirs = readdirSync(path.join(WEB, "prisma/migrations")).filter((d) =>
    statSync(path.join(WEB, "prisma/migrations", d)).isDirectory(),
  );
  assert.deepEqual(dirs.sort(), ["0_init", "1_ofertas", "2_metas"]);
  // 2_metas only adds tables: nothing is dropped or altered in older ones
  const pr4 = read("prisma/migrations/2_metas/migration.sql");
  assert.equal(/\bDROP\b/i.test(pr4), false);
  assert.deepEqual(
    [...pr4.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]).filter((t) => t !== "MonthlyGoal" && t !== "WeeklyGoal"),
    [],
  );
  assert.match(pr4, /CREATE UNIQUE INDEX "MonthlyGoal_userId_month_key" ON "MonthlyGoal"\("userId", "month"\);/);
  assert.match(pr4, /CREATE UNIQUE INDEX "WeeklyGoal_userId_weekStart_key" ON "WeeklyGoal"\("userId", "weekStart"\);/);
  const pr3 = read("prisma/migrations/1_ofertas/migration.sql");
  // drops old SuccessCase columns only when the table is empty
  assert.match(pr3, /IF EXISTS \(SELECT 1 FROM "SuccessCase"\) THEN\s+RAISE EXCEPTION/);
  assert.equal(/CONCURRENTLY/i.test(pr3), false);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "FollowUpTask_leadId_open_key" ON "FollowUpTask"\("leadId"\) WHERE "status" = 'OPEN';/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "UserMonthStats_userId_month_all_key" ON "UserMonthStats"\("userId", "month"\) WHERE "offerId" IS NULL;/,
  );
  // CREATE INDEX CONCURRENTLY cannot run inside prisma migrate deploy (lesson from #44).
  assert.equal(/CONCURRENTLY/i.test(migration), false);
  assert.match(read("prisma/migrations/migration_lock.toml"), /provider = "postgresql"/);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test("no runtime DDL, no ensure*, no schema probes in app code", () => {
  const files = walk(path.join(WEB, "src")).filter(
    (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"),
  );
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = path.relative(WEB, file);
    assert.equal(/ensure(Crm|Table)|ensure\w*Tables|ensureReadIndexes/.test(text), false, rel);
    assert.equal(/\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX)\b/i.test(text), false, rel);
    assert.equal(/pg_indexes|information_schema|db push/i.test(text), false, rel);
  }
});

test("migrations run only as an explicit step, never inside the build", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts.build, "next build");
  assert.equal(pkg.scripts["db:migrate"], "prisma migrate deploy");
  assert.equal("db:push" in pkg.scripts, false);
  assert.equal(/migrate/.test(pkg.scripts.postinstall), false);
  const vercel = JSON.parse(read("vercel.json")) as { crons?: unknown[]; buildCommand?: string };
  assert.equal(vercel.crons, undefined); // plan 2.6: no crons that wake the database
  assert.equal(vercel.buildCommand, undefined);
});

test("legacy code is out of the build", () => {
  const tsconfig = JSON.parse(read("tsconfig.json")) as { exclude: string[] };
  assert.ok(tsconfig.exclude.includes("legacy"));
  assert.match(read(".eslintignore"), /^legacy\/$/m);
});

test("health check is manual and behind a secret header", () => {
  const route = read("src/app/api/health/db/route.ts");
  assert.match(route, /HEALTH_CHECK_SECRET/);
  assert.match(route, /x-health-secret/);
  assert.match(route, /SELECT 1/);
  assert.doesNotMatch(route, /\.count\(|findMany|findFirst/);
});

test("offer-from-doc needs a session and has a per-user limit", () => {
  const route = read("src/app/api/offer-from-doc/route.ts");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.ok(post.indexOf("getServerSession") >= 0);
  assert.ok(post.indexOf("takeOfferSlot(userId)") > post.indexOf("getServerSession"));
  assert.ok(post.indexOf("takeOfferSlot(userId)") < post.indexOf("request.formData()"));
});
