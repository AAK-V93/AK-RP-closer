import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { renameShownLead } from "./crm-rename";

function fakeRename(start: {
  leadName: string;
  title: string;
  clienteReal: string;
  fail?: boolean;
}) {
  const writes: string[] = [];
  const state = {
    id: "call-1",
    leadName: start.leadName,
    title: start.title,
    filingJson: { cliente_real: start.clienteReal } as { cliente_real: string },
  };
  const prisma = {
    callRecord: {
      findFirst: async () => state,
      findMany: async () => [state],
      update: async ({
        data,
      }: {
        data: { leadName: string; title?: string; filingJson: { cliente_real: string } };
      }) => {
        if (start.fail) throw new Error("neon http rejected the write");
        writes.push(`call:${data.leadName}`);
        writes.push(`real:${data.filingJson.cliente_real}`);
        if (data.title) writes.push(`title:${data.title}`);
        state.leadName = data.leadName;
        state.filingJson = data.filingJson;
        if (data.title) state.title = data.title;
      },
      updateMany: async () => {
        writes.push("updateMany");
        throw new Error("Transactions are not supported");
      },
    },
    lead: {
      findMany: async () => [{ id: "sofia", name: "Sofía Mamani", company: "" }],
      update: async ({ data }: { data: { name: string } }) => {
        writes.push(`lead:${data.name}`);
      },
    },
    $executeRaw: async () => {
      writes.push("raw");
    },
    $transaction: async () => {
      writes.push("transaction");
      throw new Error("transaction");
    },
  };
  return { prisma: prisma as unknown as PrismaClient, writes, state };
}

test("the nombre field saves with one lead update and one call update", async () => {
  const { prisma, writes } = fakeRename({
    leadName: "Sofia Mamani Quispe",
    title: "",
    clienteReal: "",
  });
  const out = await renameShownLead(prisma, "user-1", {
    callId: "call-1",
    leadId: "sofia",
    name: "Sofía Mamani",
  });
  assert.equal("error" in out, false);
  if ("error" in out) return;
  assert.equal(out.name, "Sofía Mamani");
  assert.equal(writes.includes("updateMany"), false);
  assert.equal(writes.includes("transaction"), false);
  assert.equal(writes.includes("raw"), false);
  assert.equal(writes.some((call) => call.startsWith("lead:")), false);
  assert.deepEqual(
    writes.filter((call) => call.startsWith("call:")),
    ["call:Sofía Mamani"],
  );
});

test("nombre writes cliente_real when that is the name on screen", async () => {
  const { prisma, writes, state } = fakeRename({
    leadName: "",
    title: "Sofia Mamani Quispe",
    clienteReal: "Sofia Mamani Quispe",
  });
  const out = await renameShownLead(prisma, "user-1", {
    callId: "call-1",
    leadId: "sofia",
    name: "Sofía Mamani",
  });
  assert.equal("error" in out, false);
  if ("error" in out) return;
  assert.equal(state.leadName, "Sofía Mamani");
  assert.equal(state.filingJson.cliente_real, "Sofía Mamani");
  assert.equal(state.title, "Sofía Mamani");
  assert.equal(writes.includes("updateMany"), false);
  assert.equal(writes.some((call) => call.startsWith("lead:")), false);
});

test("a failed name save is an error", async () => {
  const { prisma, writes } = fakeRename({
    leadName: "Sofia Mamani Quispe",
    title: "",
    clienteReal: "Sofia Mamani Quispe",
    fail: true,
  });
  const out = await renameShownLead(prisma, "user-1", {
    callId: "call-1",
    leadId: "sofia",
    name: "Sofía Mamani",
  });
  assert.equal("error" in out && out.error, "No pude guardar el nombre. Inténtalo de nuevo.");
  assert.equal(writes.includes("updateMany"), false);
});
