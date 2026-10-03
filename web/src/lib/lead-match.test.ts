import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { applyExtractorToCrm } from "./crm-apply";
import { emptyExtractor } from "./extractor";
import { formatCrmStamp } from "./crm-time";
import { applyCrmChatUpdate } from "./file-call";
import { callAlreadyInCrm, filingNamesFullyMatch, matchLeadForFiling, samePersonName } from "./lead-match";

const leydis = {
  id: "leydis",
  name: "Maria Leydis Palacios Murillo",
  company: "",
  nextStep: "Acuerdo de Maria Leydis",
  lastSummary: "Notas de Maria Leydis",
};

const carlos = {
  id: "carlos",
  name: "Carlos Ramírez",
  company: "",
  nextStep: "Acuerdo de Carlos Ramírez",
  lastSummary: "Notas de Carlos Ramírez",
};

test("a shared first name is not a full-name match", () => {
  assert.equal(samePersonName("María José Vélez", "Maria Leydis Palacios Murillo"), false);
  assert.equal(samePersonName("Maria Leydis Palacios Murillo", "María José Vélez"), false);
  assert.equal(
    filingNamesFullyMatch("Maria Leydis Palacios Murillo", "María José Vélez"),
    false,
  );
  assert.equal(filingNamesFullyMatch("Carlos Ramírez", "Carlos y Luciana Quito"), false);
  assert.equal(filingNamesFullyMatch("María José Vélez", "Maria Jose Velez"), true);
  assert.equal(filingNamesFullyMatch("María José Vélez", "María Vélez"), true);
  assert.equal(
    filingNamesFullyMatch("María José Vélez", "MJ Vélez", ["MJ Vélez"]),
    true,
  );
  assert.equal(filingNamesFullyMatch("María José Vélez", "María"), false);
  assert.equal(matchLeadForFiling([leydis, carlos], "María José Vélez").kind, "none");
  assert.equal(matchLeadForFiling([leydis, carlos], "Carlos y Luciana Quito").kind, "none");
  assert.equal(matchLeadForFiling([carlos], "Carlos").kind, "ambiguous");
  assert.equal(matchLeadForFiling([leydis], "María").kind, "ambiguous");
  const exact = matchLeadForFiling(
    [{ id: "mj", name: "María José Vélez", company: "" }],
    "Maria Jose Velez",
  );
  assert.equal(exact.kind, "one");
  const alias = matchLeadForFiling(
    [{ id: "mj", name: "María José Vélez", company: "", aliases: ["MJ Vélez"] }],
    "MJ Vélez",
  );
  assert.equal(alias.kind, "one");
  assert.equal(
    matchLeadForFiling(
      [
        { id: "a", name: "María José Vélez", company: "" },
        { id: "b", name: "María Vélez", company: "" },
      ],
      "María Vélez",
    ).kind,
    "ambiguous",
  );
});

test("a unique first name is already in the CRM and a shared one is not", () => {
  const leads = [leydis, carlos];
  assert.equal(
    callAlreadyInCrm({ id: "valeria", leadName: "Valeria", title: "Impromptu Google Meet Meeting" }, [
      { id: "valeria", name: "Valeria Ríos", company: "" },
    ]),
    true,
  );
  assert.equal(
    callAlreadyInCrm({ id: "maria", leadName: "María", title: "Impromptu Google Meet Meeting" }, [
      leydis,
      { id: "mj", name: "María José Vélez", company: "" },
    ]),
    false,
  );
  assert.equal(
    callAlreadyInCrm({ id: "mj", leadName: "María José Vélez", title: "Llamada 03/10" }, leads),
    false,
  );
  assert.equal(
    callAlreadyInCrm({ id: "cq", leadName: "Carlos y Luciana Quito" }, leads),
    false,
  );
  assert.equal(
    callAlreadyInCrm({ id: "same", leadName: "Carlos Ramírez" }, leads),
    true,
  );
});

test("a mismatched call does not overwrite the other lead's acuerdo or notas", async () => {
  const maria = await fileAgainst([leydis], "María José Vélez", "Acuerdo de María José", "Notas de María José");
  assert.equal(maria.writes.some((line) => line.startsWith("update:leydis")), false);
  assert.ok(maria.writes.includes("create:María José Vélez:Acuerdo de María José:Notas de María José"));
  assert.equal(leydis.nextStep, "Acuerdo de Maria Leydis");
  assert.equal(leydis.lastSummary, "Notas de Maria Leydis");
  assert.ok(maria.writes.includes("call:confirmed"));

  const quito = await fileAgainst([carlos], "Carlos y Luciana Quito", "Acuerdo de Quito", "Notas de Quito");
  assert.equal(quito.writes.some((line) => line.startsWith("update:carlos")), false);
  assert.ok(quito.writes.includes("create:Carlos y Luciana Quito:Acuerdo de Quito:Notas de Quito"));
  assert.equal(carlos.nextStep, "Acuerdo de Carlos Ramírez");
  assert.equal(carlos.lastSummary, "Notas de Carlos Ramírez");

  const firstOnly = await fileAgainst([carlos], "Carlos", "Acuerdo nuevo", "Notas nuevas");
  assert.equal(firstOnly.writes.some((line) => line.startsWith("update:")), false);
  assert.equal(firstOnly.writes.some((line) => line.startsWith("create:")), false);
  assert.ok(firstOnly.writes.includes("call:pending"));
  assert.equal(carlos.nextStep, "Acuerdo de Carlos Ramírez");
});

test("chat update resolves one first name and does not write when two share it", async () => {
  const writes: string[] = [];
  const edson = { id: "edson", name: "Edson", company: "", nextStep: "", lastSummary: "", offerName: "" };
  const kim = { id: "kim", name: "Kimlen García", company: "", nextStep: "viejo", lastSummary: "", offerName: "" };
  const kim2 = { id: "kim2", name: "Kimlen Soto", company: "", nextStep: "otro", lastSummary: "", offerName: "" };
  let leads = [edson, kim];
  const prisma = {
    $queryRawUnsafe: async () => [],
    lead: {
      findMany: async () => leads,
      update: async ({ where, data }: { where: { id: string }; data: { nextStep?: string; amountPaid?: string } }) => {
        writes.push(`update:${where.id}:${data.nextStep || ""}:${data.amountPaid || ""}`);
        return { id: where.id, ...data };
      },
      create: async () => {
        writes.push("create");
        throw new Error("no debe crear");
      },
    },
    leadAlert: { findMany: async () => [] },
    userOffer: { findMany: async () => [] },
  } as unknown as PrismaClient;
  const paid = await applyCrmChatUpdate(prisma, "user-1", { name: "Edson", amountPaid: "2000" });
  assert.equal(paid && "id" in paid ? paid.id : "", "edson");
  const one = await applyCrmChatUpdate(prisma, "user-1", { name: "Kimlen", nextStep: "llamar el lunes" });
  assert.equal(one && "id" in one ? one.id : "", "kim");
  assert.ok(writes.includes("update:kim:llamar el lunes:"));
  leads = [edson, kim, kim2];
  const shared = await applyCrmChatUpdate(prisma, "user-1", { name: "Kimlen", nextStep: "otro" });
  assert.equal(shared, null);
  assert.equal(writes.includes("create"), false);
  assert.equal(writes.filter((line) => line.startsWith("update:kim:")).length, 1);
  assert.equal(writes.some((line) => line.startsWith("update:kim2")), false);
});

test("formatCrmStamp keeps a Bogotá clock time", () => {
  assert.equal(formatCrmStamp(new Date("2026-10-07T20:00:00.000Z")), "2026-10-07 15:00");
  assert.equal(formatCrmStamp("2026-10-07 15:00"), "2026-10-07 15:00");
});

function fileAgainst(
  leads: Array<{
    id: string;
    name: string;
    company: string;
    nextStep: string;
    lastSummary: string;
  }>,
  prospect: string,
  acuerdo: string,
  notas: string,
) {
  const writes: string[] = [];
  const prisma = {
    user: { findUnique: async () => ({ crmPrefs: {} }) },
    callRecord: {
      findFirst: async () => ({
        id: "call-1",
        userId: "user-1",
        recordedAt: new Date("2026-10-03T15:00:00.000Z"),
        filingJson: {},
        offerName: "",
        callType: "SHOW",
        leadName: prospect,
        summary: "",
      }),
      findMany: async () => [],
      update: async ({ data }: { data: { filingStatus?: string } }) => {
        writes.push(`call:${data.filingStatus}`);
        return data;
      },
    },
    lead: {
      findMany: async () => leads,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { nextStep?: string; lastSummary?: string };
      }) => {
        writes.push(`update:${where.id}:${data.nextStep}:${data.lastSummary}`);
        return { id: where.id, ...data };
      },
      create: async ({
        data,
      }: {
        data: { name: string; nextStep?: string; lastSummary?: string };
      }) => {
        writes.push(`create:${data.name}:${data.nextStep}:${data.lastSummary}`);
        return { id: "new-lead", ...data };
      },
    },
    leadAlert: {
      findMany: async () => [],
      update: async () => {
        writes.push("alert");
        return {};
      },
      updateMany: async () => ({ count: 0 }),
    },
  } as unknown as PrismaClient;
  const parsed = emptyExtractor();
  parsed.cliente_real = prospect;
  parsed.estado_agenda = "SHOW";
  parsed.requiere_seguimiento = false;
  parsed.acuerdo_seguimiento = acuerdo;
  parsed.notas_crm = notas;
  return applyExtractorToCrm(prisma, "user-1", "call-1", parsed, []).then(() => ({ writes }));
}
