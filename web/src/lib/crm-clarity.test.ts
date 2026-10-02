import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  ACTIVA_EXPLAIN,
  countOportunidadesActivas,
  filaCountLabel,
  isOportunidadActiva,
} from "./crm-activa";
import { deleteOperacionRow, leadStateFromRemaining } from "./crm-delete-row";
import { operacionGlance } from "./crm-glance";
import { hiddenInternalCount, isInternalNoise, visibleCallTitle } from "./crm-noise";

test("activa is one definition and the same count for every lead list", () => {
  assert.match(ACTIVA_EXPLAIN, /todavía puedes cerrar o cobrar/);
  assert.equal(isOportunidadActiva({ status: "seguimiento", cliente: "Lucía" }), true);
  assert.equal(isOportunidadActiva({ status: "pendiente", cliente: "Andrea" }), true);
  assert.equal(isOportunidadActiva({ status: "cobro", cliente: "Diego" }), true);
  assert.equal(isOportunidadActiva({ status: "nuevo", cliente: "Sofía Mamani" }), true);
  assert.equal(isOportunidadActiva({ status: "cerrado", cliente: "Carlos Ramírez" }), false);
  assert.equal(isOportunidadActiva({ status: "perdido", cliente: "Edson" }), false);
  assert.equal(isOportunidadActiva({ status: "seguimiento", cliente: "—" }), false);
  assert.equal(
    isOportunidadActiva({ status: "seguimiento", cliente: "Carlos Ramírez", interna: true }),
    false,
  );
  assert.equal(
    isOportunidadActiva({ cliente: "Lucía", estadoAgenda: "CIERRE VENTA" }),
    false,
  );
  const leads = [
    { name: "Lucía", status: "seguimiento" },
    { name: "Lucia", status: "seguimiento" },
    { name: "Andrea", status: "cobro" },
    { name: "Diego", status: "perdido" },
    { name: "Sofía Mamani", status: "nuevo" },
    { name: "Carlos Ramírez", status: "cerrado" },
    { name: "Edson", status: "seguimiento" },
  ];
  assert.equal(countOportunidadesActivas(leads), 4);
  assert.equal(filaCountLabel(27, 27), "27 filas");
  assert.equal(filaCountLabel(6, 27), "6 de 27 filas");
});

test("internal and untitled rows stay in the data but are the hidden set", () => {
  const feedback = { cliente: "—", title: "Feedback de la semana", estadoAgenda: "SHOW" };
  const coaching = { cliente: "", title: "Coaching interno", estadoAgenda: "" };
  const roleplay = { cliente: "Equipo", title: "Roleplay de cierre", estadoAgenda: "SHOW" };
  const meetNamed = {
    cliente: "Carlos Ramírez",
    title: "Impromptu Google Meet Meeting",
    estadoAgenda: "SHOW",
  };
  const meetBare = {
    cliente: "",
    title: "Impromptu Google Meet Meeting",
    estadoAgenda: "SHOW",
  };
  const sales = { cliente: "Lucía", title: "Lucía · decisión", estadoAgenda: "SHOW" };
  assert.equal(isInternalNoise(feedback), true);
  assert.equal(isInternalNoise(coaching), true);
  assert.equal(isInternalNoise(roleplay), true);
  assert.equal(isInternalNoise(meetBare), true);
  assert.equal(isInternalNoise(meetNamed), false);
  assert.equal(isInternalNoise(sales), false);
  assert.equal(
    visibleCallTitle({
      title: "Impromptu Google Meet Meeting",
      leadName: "Carlos Ramírez",
      date: "2026-10-02",
    }),
    "Carlos Ramírez",
  );
  assert.equal(
    visibleCallTitle({
      title: "Impromptu Google Meet Meeting",
      leadName: "",
      date: "2026-09-30T15:00:00.000Z",
    }),
    "Llamada sin título · 2026-09-30",
  );
  const rows = [
    { interna: isInternalNoise(feedback) },
    { interna: isInternalNoise(meetNamed) },
    { interna: isInternalNoise(meetBare) },
    { interna: isInternalNoise(sales) },
  ];
  assert.equal(hiddenInternalCount(rows), 2);
  assert.equal(rows.filter((row) => !row.interna).length, 2);
});

test("deleting Carlos's duplicate recalculates próximo and estado from the remaining row", async () => {
  const original = {
    id: "carlos-original",
    userId: "user-1",
    leadName: "Carlos Ramírez",
    title: "Carlos Ramírez",
    estadoAgenda: "SHOW",
    recordedAt: new Date("2026-10-02T15:00:00.000Z"),
    createdAt: new Date("2026-10-02T15:00:00.000Z"),
    summary: "",
    filingJson: {
      cliente_real: "Carlos Ramírez",
      estado_agenda: "SHOW",
      tipo_seguimiento: "DECISION",
      acuerdo_seguimiento: "Decisión",
      proximo_seguimiento: "2026-10-02 10:00",
    },
  };
  const duplicate = {
    id: "carlos-duplicate",
    userId: "user-1",
    leadName: "Carlos Ramírez",
    title: "Impromptu Google Meet Meeting",
    estadoAgenda: "REPROGRAMA",
    recordedAt: new Date("2026-09-30T15:00:00.000Z"),
    createdAt: new Date("2026-09-30T15:00:00.000Z"),
    summary: "",
    filingJson: {
      cliente_real: "Carlos Ramírez",
      estado_agenda: "REPROGRAMA",
      tipo_seguimiento: "SEGUNDA_REUNION",
      acuerdo_seguimiento: "Segunda reunión",
      proximo_seguimiento: "2026-10-03 10:00",
    },
  };
  assert.equal(leadStateFromRemaining([original, duplicate]).proximo, "2026-10-02 10:00");
  assert.equal(leadStateFromRemaining([original, duplicate]).status, "seguimiento");
  assert.equal(leadStateFromRemaining([duplicate]).proximo, "2026-10-03 10:00");
  assert.equal(leadStateFromRemaining([duplicate]).nextStep, "Segunda reunión");
  assert.equal(leadStateFromRemaining([]).status, "nuevo");
  assert.equal(leadStateFromRemaining([]).nextStepAt, null);

  const calls: string[] = [];
  const records = [original, duplicate];
  const lead = {
    id: "lead-carlos",
    userId: "user-1",
    name: "Carlos Ramírez",
    company: "",
    status: "seguimiento",
    nextStep: "Segunda reunión",
    nextStepAt: new Date("2026-10-03T15:00:00.000Z"),
  };
  let leadPatch: { status?: string; nextStep?: string; nextStepAt?: Date | null } = {};
  const prisma = {
    callRecord: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        records.find((row) => row.id === where.id) || null,
      findMany: async () => records.slice(),
      delete: async ({ where }: { where: { id: string } }) => {
        calls.push(`delete:${where.id}`);
        const index = records.findIndex((row) => row.id === where.id);
        if (index >= 0) records.splice(index, 1);
        return { id: where.id };
      },
      deleteMany: async () => {
        calls.push("deleteMany");
        throw new Error("deleteMany");
      },
      updateMany: async () => {
        calls.push("updateMany");
        throw new Error("updateMany");
      },
    },
    lead: {
      findMany: async () => [lead],
      update: async ({ data }: { data: typeof leadPatch }) => {
        calls.push("lead.update");
        leadPatch = data;
        return lead;
      },
    },
    leadAlert: {
      findMany: async ({ where }: { where: { callRecordId?: string; threadId?: string } }) => {
        if (where.callRecordId === "carlos-duplicate") return [{ id: "alert-dup" }];
        if (where.threadId === "thread-dup") return [{ id: "alert-thread" }];
        return [];
      },
      delete: async ({ where }: { where: { id: string } }) => {
        calls.push(`alert.delete:${where.id}`);
        return { id: where.id };
      },
      update: async ({ where }: { where: { id: string } }) => {
        calls.push(`alert.update:${where.id}`);
        return { id: where.id };
      },
    },
    followupThread: {
      findMany: async () => [{ id: "thread-dup" }],
      update: async ({ where, data }: { where: { id: string }; data: { estado: string } }) => {
        calls.push(`thread:${where.id}:${data.estado}`);
        return { id: where.id };
      },
    },
    commission: {
      findMany: async () => [],
    },
    $transaction: async () => {
      calls.push("transaction");
      throw new Error("transaction");
    },
  };

  const out = await deleteOperacionRow(prisma as unknown as PrismaClient, "user-1", duplicate.id);
  assert.equal("ok" in out && out.ok, true);
  if (!("ok" in out)) return;
  assert.equal(out.proximo, "2026-10-02 10:00");
  assert.equal(out.status, "seguimiento");
  assert.equal(out.nextStep, "Decisión");
  assert.equal(out.cliente, "Carlos Ramírez");
  assert.equal(leadPatch.status, "seguimiento");
  assert.equal(leadPatch.nextStep, "Decisión");
  assert.equal(leadPatch.nextStepAt?.toISOString(), "2026-10-02T15:00:00.000Z");
  assert.deepEqual(
    calls.filter((item) => item.startsWith("delete:")),
    ["delete:carlos-duplicate"],
  );
  assert.equal(calls.includes("deleteMany"), false);
  assert.equal(calls.includes("updateMany"), false);
  assert.equal(calls.includes("transaction"), false);
  assert.ok(calls.includes("thread:thread-dup:cerrado"));
  assert.equal(records.map((row) => row.id).join(","), "carlos-original");
});

test("operación glance names the step, the last contact and what is next", () => {
  const glance = operacionGlance({
    fecha: "2026-09-30",
    ultimoContacto: "2026-10-02",
    paso: "2 de 4",
    tipoSeguimiento: "SEGUNDA_REUNION",
    fechaProximo: "2026-10-03 10:00",
  });
  assert.equal(glance.paso, "Paso 2 de 4");
  assert.equal(glance.ultimoContacto, "2026-10-02");
  assert.equal(glance.siguiente, "Segunda reunión · 2026-10-03 10:00");
  assert.match(glance.line, /Paso 2 de 4/);
  assert.match(glance.line, /Último contacto 2026-10-02/);
});
