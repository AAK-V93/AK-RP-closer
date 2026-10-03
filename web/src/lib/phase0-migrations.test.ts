import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("baseline is a snapshot and the foreign key is a later migration", () => {
  const baseline = read("../../prisma/migrations/0_init/migration.sql");
  const foreignKey = read("../../prisma/migrations/1_callrecord_user_fk/migration.sql");
  const lock = read("../../prisma/migrations/migration_lock.toml");
  const schema = read("../../prisma/schema.prisma");

  assert.match(lock, /provider = "postgresql"/);
  assert.match(baseline, /CREATE TABLE "CallRecord"/);
  assert.match(baseline, /"filingStatus" TEXT NOT NULL DEFAULT 'confirmed'/);
  assert.match(baseline, /"filingJson" JSONB NOT NULL DEFAULT '\{\}'/);
  assert.match(baseline, /"updatedAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(baseline, /CREATE INDEX "CallRecord_userId_recordedAt_idx"/);
  assert.match(baseline, /CREATE INDEX "LeadAlert_threadId_idx"/);
  assert.equal(baseline.includes("CallRecord_userId_fkey"), false);

  assert.match(foreignKey, /ADD CONSTRAINT "CallRecord_userId_fkey"/);
  assert.match(foreignKey, /ON DELETE CASCADE ON UPDATE CASCADE NOT VALID/);
  assert.match(foreignKey, /^COMMIT;$/m);
  assert.match(foreignKey, /VALIDATE CONSTRAINT "CallRecord_userId_fkey"/);
  assert.ok(foreignKey.indexOf("NOT VALID") < foreignKey.indexOf("VALIDATE CONSTRAINT"));

  assert.match(
    schema,
    /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/,
  );
  assert.match(schema, /callRecords\s+CallRecord\[\]/);
  assert.match(schema, /userId\s+String\n\s+user\s+User/);
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
  assert.match(orphans, /SELECT COUNT\(\*\)::bigint AS n/);
  assert.equal(/\b(updateMany|deleteMany|\$executeRaw|\$transaction|INSERT|UPDATE|DELETE)\b/.test(orphans), false);
});
