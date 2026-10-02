import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { parseCashInput, setRecordedCash } from "./crm-cash";

test("cash input accepts zero and Spanish thousands", () => {
  assert.deepEqual(parseCashInput(0), { ok: true, amount: 0 });
  assert.deepEqual(parseCashInput(""), { ok: true, amount: 0 });
  assert.deepEqual(parseCashInput(null), { ok: true, amount: 0 });
  assert.deepEqual(parseCashInput("0"), { ok: true, amount: 0 });
  assert.deepEqual(parseCashInput("2.000"), { ok: true, amount: 2000 });
  assert.deepEqual(parseCashInput("2000"), { ok: true, amount: 2000 });
  assert.equal(parseCashInput(-1).ok, false);
  assert.equal(parseCashInput("nada").ok, false);
  assert.equal(parseCashInput(2_000_000).ok, false);
});

test("setting cash to zero updates one call and the matching lead", async () => {
  const writes: string[] = [];
  const call = {
    id: "call-carlos",
    userId: "user-1",
    leadName: "Carlos Ramírez",
    filingJson: { cash_collected: 2000 },
  };
  const lead = { id: "carlos", name: "Carlos Ramírez", company: "", amountPaid: "2000" };
  const prisma = {
    callRecord: {
      findFirst: async () => call,
      update: async ({ data }: { data: { cashCollected: number; filingJson: { cash_collected: number } } }) => {
        writes.push(`call:${data.cashCollected}`);
        assert.equal(data.filingJson.cash_collected, data.cashCollected);
      },
      updateMany: async () => {
        writes.push("updateMany");
      },
    },
    lead: {
      findMany: async () => [lead],
      update: async ({ data }: { data: { amountPaid: string } }) => {
        writes.push(`paid:${data.amountPaid}`);
      },
      updateMany: async () => {
        writes.push("updateMany");
      },
    },
    $transaction: async () => {
      writes.push("transaction");
    },
  };
  const cleared = await setRecordedCash(prisma as unknown as PrismaClient, "user-1", "call-carlos", 0);
  assert.deepEqual(cleared, { ok: true });
  assert.deepEqual(writes, ["call:0", "paid:0"]);

  writes.length = 0;
  const saved = await setRecordedCash(prisma as unknown as PrismaClient, "user-1", "call-carlos", "2.000");
  assert.deepEqual(saved, { ok: true });
  assert.deepEqual(writes, ["call:2000", "paid:2000"]);

  writes.length = 0;
  const bad = await setRecordedCash(prisma as unknown as PrismaClient, "user-1", "call-carlos", -5);
  assert.equal("error" in bad, true);
  assert.deepEqual(writes, []);
});
