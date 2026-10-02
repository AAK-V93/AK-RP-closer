import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { renameShownLead } from "./crm-rename";

test("the nombre field saves with one lead update and one call statement", async () => {
  const calls: string[] = [];
  const prisma = {
    callRecord: {
      findFirst: async () => ({ id: "call-1", leadName: "Sofia Mamani Quispe" }),
      updateMany: async () => {
        calls.push("updateMany");
        throw new Error("Transactions are not supported");
      },
    },
    lead: {
      findMany: async () => [{ id: "sofia", name: "Sofía Mamani", company: "" }],
      update: async ({ data }: { data: { name: string } }) => {
        calls.push(`lead:${data.name}`);
      },
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`raw:${strings.join(" ")}`);
      calls.push(`vals:${values.map((value) => String(value)).join("|")}`);
      return 1;
    },
  };
  const out = await renameShownLead(prisma as unknown as PrismaClient, "user-1", {
    callId: "call-1",
    leadId: "sofia",
    name: "Sofía Mamani",
  });
  assert.equal("error" in out, false);
  if ("error" in out) return;
  assert.equal(out.name, "Sofía Mamani");
  assert.equal(calls.includes("updateMany"), false);
  assert.equal(calls.some((call) => call.startsWith("lead:")), false);
  assert.equal(calls.filter((call) => call.startsWith("raw:")).length, 1);
  const vals = calls.find((call) => call.startsWith("vals:")) || "";
  assert.match(vals, /Sofia Mamani Quispe/);
  assert.match(vals, /Sofía Mamani/);
});
