// Prisma 6.16.3 refuses `migrate diff --from-migrations` without
// --shadow-database-url. This suite does not run that diff.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function tableBlock(sql: string, table: string) {
  const start = sql.indexOf(`CREATE TABLE "${table}"`);
  assert.ok(start >= 0, table);
  const end = sql.indexOf("CREATE TABLE", start + 12);
  return sql.slice(start, end === -1 ? undefined : end);
}

const missingForeignKeys = [
  ["ClientTranscript_offerId_fkey", "SET NULL"],
  ["Lead_userId_fkey", "CASCADE"],
  ["ExtractorFeedback_userId_fkey", "CASCADE"],
  ["LeadAlert_userId_fkey", "CASCADE"],
  ["LeadAlert_leadId_fkey", "CASCADE"],
  ["LeadAlert_threadId_fkey", "SET NULL"],
  ["FollowupThread_userId_fkey", "CASCADE"],
  ["FollowupThread_leadId_fkey", "CASCADE"],
  ["FollowupTouch_threadId_fkey", "CASCADE"],
  ["CommissionRule_userId_fkey", "CASCADE"],
  ["CommissionRule_offerId_fkey", "SET NULL"],
  ["Commission_userId_fkey", "CASCADE"],
  ["Commission_leadId_fkey", "SET NULL"],
  ["FollowupPack_userId_fkey", "CASCADE"],
  ["FollowupLibraryScript_packId_fkey", "CASCADE"],
  ["FollowupStar_userId_fkey", "CASCADE"],
  ["FollowupStar_packId_fkey", "CASCADE"],
  ["PushSubscription_userId_fkey", "CASCADE"],
] as const;

const orphanLabels = [
  "CallRecord.userId",
  "ClientTranscript.offerId",
  "Lead.userId",
  "ExtractorFeedback.userId",
  "LeadAlert.userId",
  "LeadAlert.leadId",
  "LeadAlert.threadId",
  "FollowupThread.userId",
  "FollowupThread.leadId",
  "FollowupTouch.threadId",
  "CommissionRule.userId",
  "CommissionRule.offerId",
  "Commission.userId",
  "Commission.leadId",
  "FollowupPack.userId",
  "FollowupLibraryScript.packId",
  "FollowupStar.userId",
  "FollowupStar.packId",
  "PushSubscription.userId",
];

test("0_init matches the hot-push and later migrations add the missing constraints", () => {
  const baseline = read("../../prisma/migrations/0_init/migration.sql");
  const callRecordFk = read("../../prisma/migrations/1_callrecord_user_fk/migration.sql");
  const missing = read("../../prisma/migrations/2_missing_constraints/migration.sql");
  const lock = read("../../prisma/migrations/migration_lock.toml");
  const schema = read("../../prisma/schema.prisma");

  assert.match(lock, /provider = "postgresql"/);
  assert.match(baseline, /CREATE TABLE "CallRecord"/);
  assert.match(baseline, /"filingStatus" TEXT NOT NULL DEFAULT 'confirmed'/);
  assert.match(baseline, /"filingJson" JSONB NOT NULL DEFAULT '\{\}'/);
  assert.match(tableBlock(baseline, "Lead"), /"updatedAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  const coachUpdated = tableBlock(baseline, "CoachProfile")
    .split("\n")
    .find((line) => line.includes('"updatedAt"'));
  assert.equal(coachUpdated?.includes("DEFAULT"), false);
  assert.match(baseline, /FathomConnection_userId_fkey/);
  assert.match(baseline, /ClientTranscript_userId_fkey/);
  assert.match(baseline, /CREATE INDEX "CallRecord_userId_estadoAgenda_idx"/);
  assert.match(baseline, /CREATE INDEX "CallRecord_userId_filingStatus_idx"/);
  assert.equal(baseline.includes("CallRecord_userId_recordedAt_idx"), false);
  assert.equal(baseline.includes("LeadAlert_threadId_idx"), false);
  assert.equal(baseline.includes("CallRecord_userId_fkey"), false);
  for (const [name] of missingForeignKeys) {
    assert.equal(baseline.includes(name), false, name);
  }

  assert.match(callRecordFk, /ADD CONSTRAINT "CallRecord_userId_fkey"/);
  assert.match(callRecordFk, /ON DELETE CASCADE ON UPDATE CASCADE NOT VALID/);
  assert.match(callRecordFk, /^COMMIT;$/m);
  assert.match(callRecordFk, /VALIDATE CONSTRAINT "CallRecord_userId_fkey"/);
  assert.ok(callRecordFk.indexOf("NOT VALID") < callRecordFk.indexOf("VALIDATE CONSTRAINT"));

  const missingSql = missing
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.match(missingSql, /CREATE INDEX IF NOT EXISTS "CallRecord_userId_recordedAt_idx"/);
  assert.match(missingSql, /CREATE INDEX IF NOT EXISTS "LeadAlert_threadId_idx"/);
  assert.equal(/CONCURRENTLY/i.test(missingSql), false);
  for (const [name, onDelete] of missingForeignKeys) {
    const addAt = missing.indexOf(`ADD CONSTRAINT "${name}"`);
    const validateAt = missing.indexOf(`VALIDATE CONSTRAINT "${name}"`);
    assert.ok(addAt >= 0 && validateAt > addAt, name);
    const between = missing.slice(addAt, validateAt);
    assert.match(between, new RegExp(`ON DELETE ${onDelete} ON UPDATE CASCADE NOT VALID`));
    assert.match(between, /^COMMIT;$/m);
  }

  assert.match(schema, /callRecords\s+CallRecord\[\]/);
  assert.match(schema, /@@index\(\[userId, recordedAt\]\)/);
  assert.match(schema, /@@index\(\[threadId\]\)/);
});

test("ensureCrmTables stays frozen and deploy does not migrate", () => {
  const prismaTs = read("./prisma.ts");
  const pkg = JSON.parse(read("../../package.json")) as {
    scripts: { build: string; postinstall: string; test: string };
  };
  const vercel = read("../../vercel.json");
  const orphans = read("../../scripts/callrecord-orphans-dry-run.ts");

  const frozen = prismaTs.indexOf("New schema changes go only through web/prisma/migrations.");
  const ensure = prismaTs.indexOf("export async function ensureCrmTables");
  assert.ok(frozen > 0 && frozen < ensure);
  const ensureBody = prismaTs.slice(ensure, prismaTs.indexOf("export async function ensureCoachTables"));
  assert.equal(ensureBody.includes("CallRecord_userId_fkey"), false);
  assert.equal(ensureBody.includes("CallRecord_userId_recordedAt_idx"), false);
  assert.equal(ensureBody.includes("LeadAlert_threadId_idx"), false);

  assert.equal(pkg.scripts.build, "next build");
  assert.equal(pkg.scripts.build.includes("migrate"), false);
  assert.equal(pkg.scripts.build.includes("db push"), false);
  assert.match(pkg.scripts.postinstall, /prisma generate/);
  assert.equal(pkg.scripts.postinstall.includes("migrate deploy"), false);
  assert.equal(pkg.scripts.postinstall.includes("db push"), false);
  assert.equal(vercel.includes("migrate"), false);
  assert.equal(vercel.includes("db push"), false);

  assert.ok(orphans.indexOf("--apply") < orphans.indexOf("getPrisma"));
  assert.match(orphans, /SELECT COUNT\(\*\)::bigint/);
  assert.equal(/\b(updateMany|deleteMany|\$executeRaw|\$transaction|INSERT|UPDATE|DELETE)\b/.test(orphans), false);
  for (const label of orphanLabels) {
    assert.ok(orphans.includes(`"${label}"`), label);
  }
});
