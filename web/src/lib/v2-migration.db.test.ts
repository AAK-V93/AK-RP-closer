// v2, PR 1: 0_init applies to a fresh, empty Postgres and the app can read UserCounters.
// Runs only with TEST_DATABASE_URL (+ SHADOW_DATABASE_URL) pointing at a throwaway local
// Postgres. It wipes the public schema of that database, so it refuses any Neon host.
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55432/v2test \
//   SHADOW_DATABASE_URL=postgresql://postgres@localhost:55432/v2shadow \
//   npx tsx --test src/lib/v2-migration.db.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createUserCounters } from "@/lib/write/user-counters";

const WEB = path.resolve(__dirname, "../..");
const url = process.env.TEST_DATABASE_URL?.trim() ?? "";
const shadow = process.env.SHADOW_DATABASE_URL?.trim() ?? "";

function hostOf(raw: string) {
  try {
    const u = new URL(raw);
    return u.searchParams.get("host") || u.hostname;
  } catch {
    return "";
  }
}

const isLocal = (raw: string) => /^(localhost|127\.0\.0\.1|\/)/.test(hostOf(raw)) && !/neon/i.test(raw);
const skip = !url || !shadow
  ? "set TEST_DATABASE_URL and SHADOW_DATABASE_URL to a local throwaway Postgres"
  : !isLocal(url) || !isLocal(shadow)
    ? "refusing: these tests wipe the database, only localhost is allowed"
    : false;

const prisma = () => new PrismaClient({ datasourceUrl: url });

function prismaCli(args: string[], env: Record<string, string> = {}) {
  return execFileSync(path.join(WEB, "node_modules/.bin/prisma"), args, {
    cwd: WEB,
    env: { ...process.env, DATABASE_URL: url, ...env },
    encoding: "utf8",
    stdio: "pipe",
  });
}

test("migrations apply to an empty database and matches schema.prisma", { skip }, async () => {
  const db = prisma();
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.$executeRawUnsafe(`CREATE SCHEMA public`);
  await db.$disconnect();

  const out = prismaCli(["migrate", "deploy"]);
  assert.match(out, /0_init/);

  // Same check as `npm run db:check`; --exit-code makes a diff throw.
  prismaCli([
    "migrate", "diff",
    "--from-migrations", "prisma/migrations",
    "--to-schema-datamodel", "prisma/schema.prisma",
    "--shadow-database-url", shadow,
    "--exit-code",
  ]);
  prismaCli([
    "migrate", "diff",
    "--from-url", url,
    "--to-schema-datamodel", "prisma/schema.prisma",
    "--exit-code",
  ]);
});

test("smoke: a new user gets empty counters and the app reads them", { skip }, async () => {
  const db = prisma();
  try {
    const user = await db.user.create({
      data: { email: `smoke-${Date.now()}@example.test`, name: "Carlos Ramírez" },
      select: { id: true, timezone: true, currency: true },
    });
    assert.equal(user.timezone, "America/Bogota");
    assert.equal(user.currency, "USD");
    await createUserCounters(db, user.id);
    await createUserCounters(db, user.id); // idempotent
    const counters = await db.userCounters.findUnique({
      where: { userId: user.id },
      select: {
        pendingConfirmCount: true,
        followingCount: true,
        callsSinceLastClose: true,
        lastCloseAt: true,
        topObjectionLabel: true,
      },
    });
    assert.deepEqual(counters, {
      pendingConfirmCount: 0,
      followingCount: 0,
      callsSinceLastClose: 0,
      lastCloseAt: null,
      topObjectionLabel: null,
    });
    assert.equal(await db.userCounters.count({ where: { userId: user.id } }), 1);
  } finally {
    await db.$disconnect();
  }
});

test("one OPEN follow-up per lead, one all-offers stats row per month", { skip }, async () => {
  const db = prisma();
  try {
    const user = await db.user.create({ data: { email: `idx-${Date.now()}@example.test` } });
    const lead = await db.lead.create({
      data: { userId: user.id, name: "Carlos Ramírez", nameNorm: "carlos ramirez" },
    });
    const task = { userId: user.id, leadId: lead.id, dueDate: new Date("2026-10-12"), kind: "ESCRIBIR", origin: "MANUAL" } as const;
    const first = await db.followUpTask.create({ data: task });
    await assert.rejects(db.followUpTask.create({ data: task }), /Unique constraint/);
    await db.followUpTask.update({ where: { id: first.id }, data: { status: "DONE", doneAt: new Date() } });
    await db.followUpTask.create({ data: task }); // a new OPEN one is fine once the old is done

    const month = new Date("2026-10-01");
    await db.userMonthStats.create({ data: { userId: user.id, month } });
    await assert.rejects(db.userMonthStats.create({ data: { userId: user.id, month } }), /Unique constraint/);
    const offer = await db.offer.create({ data: { userId: user.id, name: "Círculo Millonario" } });
    await db.userMonthStats.create({ data: { userId: user.id, month, offerId: offer.id } });
    await assert.rejects(
      db.userMonthStats.create({ data: { userId: user.id, month, offerId: offer.id } }),
      /Unique constraint/,
    );

    // lastCallId is a plain FK: two leads may point at the same call; deleting it nulls both.
    const call = await db.call.create({
      data: { userId: user.id, source: "UPLOAD", sourceId: "smoke-1", title: "Llamada", recordedAt: new Date() },
    });
    const other = await db.lead.create({
      data: { userId: user.id, name: "Luciana", nameNorm: "luciana", lastCallId: call.id },
    });
    await db.lead.update({ where: { id: lead.id }, data: { lastCallId: call.id } });
    await db.call.delete({ where: { id: call.id } });
    const after = await db.lead.findUnique({ where: { id: other.id }, select: { lastCallId: true } });
    assert.equal(after?.lastCallId, null);
    await db.lead.update({ where: { id: lead.id }, data: { lastCallId: null } });

    // A success case only needs its key; one case per (offer, key).
    await db.successCase.create({ data: { userId: user.id, offerId: offer.id, externalKey: "manual:ana", nameUser: "Ana" } });
    await assert.rejects(
      db.successCase.create({ data: { userId: user.id, offerId: offer.id, externalKey: "manual:ana" } }),
      /Unique constraint/,
    );

    // Leads start in SEGUIMIENTO with zero attempts; nothing is invented.
    const fresh = await db.lead.findUnique({
      where: { id: lead.id },
      select: { status: true, attemptsSinceLastCall: true, potentialCommission: true, oneLine: true },
    });
    assert.deepEqual(fresh, { status: "SEGUIMIENTO", attemptsSinceLastCall: 0, potentialCommission: null, oneLine: null });
  } finally {
    await db.$disconnect();
  }
});
