import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  ACTIVA_EXPLAIN,
  countOportunidadesActivas,
  filaCountLabel,
  isOportunidadActiva,
  latestActiveRows,
  operacionCountLine,
  withEveryActiveLead,
} from "./crm-activa";
import { deleteOperacionRow, leadStateFromRemaining } from "./crm-delete-row";
import { derivedPaso, operacionGlance } from "./crm-glance";
import {
  AHORA_TAB_NOTE,
  COBRADO_PERIOD_NOTE,
  PERIODO_TAB_NOTE,
  cobradoPeriodLine,
  seguimientosHeader,
} from "./crm-period-copy";
import {
  durationMinutesFromTranscript,
  hiddenInternalCount,
  isInternalNoise,
  joinDistinct,
  linkedToCrmLead,
  visibleCallTitle,
} from "./crm-noise";
import { callAlreadyInCrm } from "./lead-match";

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
    "Llamada del 30 sep, 10:00",
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

test("solo activas keeps the latest row of each active lead", () => {
  const active = Array.from({ length: 23 }, (_, index) => ({
    id: `a-${index}`,
    cliente: `Lead ${index + 1}`,
    fecha: "2026-10-01",
    leadStatus: "seguimiento",
    estadoAgenda: "SHOW",
  }));
  const duplicates = active.slice(0, 7).map((row, index) => ({
    ...row,
    id: `old-${index}`,
    fecha: "2026-09-01",
  }));
  const closed = {
    id: "closed",
    cliente: "Edson",
    fecha: "2026-10-02",
    leadStatus: "cerrado",
    estadoAgenda: "CIERRE VENTA",
  };
  const nameless = {
    id: "bare",
    cliente: "Sin estado",
    fecha: "2026-10-02",
    leadStatus: "",
    estadoAgenda: "SHOW",
  };
  const rows = [...active, ...duplicates, closed, nameless];
  assert.equal(rows.length, 32);
  const only = latestActiveRows(rows.filter((row) => row.id !== "bare"));
  assert.equal(only.length, 23);
  assert.equal(only.some((row) => row.id.startsWith("old-")), false);
  assert.equal(only.some((row) => row.id === "closed"), false);
  assert.equal(
    operacionCountLine({
      shown: rows.length - 1,
      inScope: rows.length - 1,
      onlyActivas: false,
      activeRows: 23,
      oportunidades: 23,
    }),
    "31 filas · 23 oportunidades activas",
  );
  assert.equal(
    operacionCountLine({
      shown: 23,
      inScope: 23,
      onlyActivas: true,
      activeRows: 23,
      oportunidades: 23,
    }),
    "23 filas · 23 activas",
  );
});

test("solo activas renders the active lead that has no call row", () => {
  const rows = Array.from({ length: 22 }, (_, index) => ({
    id: `a-${index}`,
    cliente: `Lead ${index + 1}`,
    fecha: "2026-10-01",
    leadStatus: "seguimiento",
    estadoAgenda: "SHOW",
  }));
  const leads = [
    ...rows.map((row, index) => ({
      id: `lead-${index}`,
      name: row.cliente,
      status: "seguimiento",
    })),
    { id: "sola", name: "Nuria Solís", status: "seguimiento" },
  ];
  const filled = withEveryActiveLead(rows, leads, (lead) => ({
    id: `lead:${lead.id}`,
    cliente: lead.name,
    fecha: null,
    leadStatus: lead.status,
    leadId: lead.id,
    estadoAgenda: "",
  }));
  const active = filled.filter((row) => row.leadStatus === "seguimiento");
  assert.equal(active.length, 23);
  assert.equal(active.some((row) => row.id === "lead:sola" && row.cliente === "Nuria Solís"), true);
  assert.equal(
    operacionCountLine({
      shown: 23,
      inScope: 23,
      onlyActivas: true,
      activeRows: 23,
      oportunidades: 23,
    }),
    "23 filas · 23 activas",
  );

  const mismatched = withEveryActiveLead(
    [
      {
        id: "call-quispe",
        cliente: "Sofia Mamani Quispe",
        fecha: "2026-09-01",
        leadStatus: "",
        estadoAgenda: "SHOW",
      },
    ],
    [{ id: "sofia", name: "Sofía Mamani", status: "seguimiento" }],
    (lead) => ({
      id: `lead:${lead.id}`,
      cliente: lead.name,
      fecha: null,
      leadStatus: lead.status,
      leadId: lead.id,
      estadoAgenda: "",
    }),
  );
  assert.equal(mismatched.length, 1);
  assert.equal(mismatched[0]?.id, "call-quispe");
  assert.equal(mismatched[0]?.leadStatus, "seguimiento");
});

test("a follow-up type gets a step even when none is stored", () => {
  assert.equal(derivedPaso({ tipo: "DECISION", paso: "—" }), "Paso 1 de 4");
  assert.equal(derivedPaso({ tipo: "DECISION", paso: "2 de 4" }), "Paso 2 de 4");
  assert.equal(derivedPaso({ tipo: "RETOMAR", intentos: 1 }), "Paso 2 de 3");
  assert.equal(derivedPaso({ tipo: "SEGUNDA REUNION" }), "Paso 1 de 1");
  assert.equal(derivedPaso({ tipo: "SEGUIMIENTO" }), "Paso 1 de 1");
  const diego = operacionGlance({
    fecha: "2026-09-30",
    tipoSeguimiento: "DECISION",
    paso: "—",
    fechaProximo: "2026-10-03 10:00",
  });
  assert.equal(diego.paso, "Paso 1 de 4");
  assert.match(diego.line, /Paso 1 de 4/);
  assert.match(diego.line, /Siguiente: Decisión/);
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

test("llamadas list and detail replace an Impromptu title", () => {
  assert.equal(
    visibleCallTitle({
      title: "Impromptu Google Meet Meeting",
      leadName: "Sofia Mamani Quispe",
      date: "2026-10-02",
    }),
    "Sofia Mamani Quispe",
  );
  assert.equal(
    visibleCallTitle({
      title: "Impromptu Google Meet Meeting",
      leadName: "Impromptu Google Meet Meeting",
      date: "2026-10-01",
    }),
    "Llamada del 1 oct",
  );
  assert.equal(
    visibleCallTitle({
      title: "Llamada sin título",
      leadName: "",
      date: "2026-09-30T15:00:00.000Z",
      durationMinutes: 32,
    }),
    "Llamada del 30 sep, 10:00 · 32 min",
  );
  assert.equal(
    visibleCallTitle({
      title: "",
      leadName: "",
      summary: "Hola, revisamos el plan de pagos y la fecha de inicio del programa",
    }),
    "revisamos el plan de pagos y la fecha",
  );
  assert.equal(
    durationMinutesFromTranscript("00:00:00 Hola\nseguimos\n00:32:10 cierre de la llamada"),
    32,
  );
  assert.equal(linkedToCrmLead("Valeria Ríos", ["Valeria Rios"]), true);
  assert.equal(linkedToCrmLead("", ["Valeria Rios"]), false);
  assert.equal(joinDistinct(["Cerró", "Cerró"]), "Cerró");
  assert.equal(joinDistinct(["Valeria Ríos", "Cerró", "Cerró"]), "Valeria Ríos · Cerró");
});

test("a call already in the CRM is not waiting to be classified", () => {
  const leads = [
    { id: "valeria", name: "Valeria Ríos", telefono: "+57 300 111 2233", callIds: ["call-valeria"] },
    { id: "jubher", name: "Jubher", telefono: "573009998877", callIds: [] },
    { id: "edson", name: "Edson", telefono: "", callIds: ["call-edson"] },
  ];
  assert.equal(
    callAlreadyInCrm({ id: "pending-1", leadName: "Valeria", title: "Impromptu Google Meet Meeting" }, leads),
    true,
  );
  assert.equal(
    callAlreadyInCrm(
      { id: "pending-2", leadName: "", title: "Víctor", filingJson: { telefono: "+57 300 999 8877" } },
      leads,
    ),
    true,
  );
  assert.equal(callAlreadyInCrm({ id: "call-edson", leadName: "Llamada sin título" }, leads), true);
  assert.equal(
    callAlreadyInCrm({ id: "new", leadName: "Persona Nueva", title: "Llamada sin título" }, leads),
    false,
  );
  assert.equal(
    callAlreadyInCrm(
      { id: "meet-valeria", leadName: "", title: "Impromptu Google Meet Meeting", summary: "Valeria Ríos 29/9" },
      leads,
    ),
    true,
  );
  assert.equal(
    callAlreadyInCrm({ id: "meet-dennis", leadName: "", title: "Dennis Sanchez Solorzano" }, leads),
    false,
  );
});

test("cobrado este mes and cobrado total are named apart, and seguimientos shows the saldo", () => {
  assert.equal(
    cobradoPeriodLine("USD 0", "USD 1.066"),
    "Cobrado este mes USD 0. Cobrado total USD 1.066.",
  );
  assert.equal(
    cobradoPeriodLine("USD 533", "USD 1.066"),
    "Cobrado este mes USD 533. Cobrado total USD 1.066.",
  );
  assert.match(COBRADO_PERIOD_NOTE, /fecha en el mes/);
  assert.match(COBRADO_PERIOD_NOTE, /Cobrado total suma todos los pagos/);
  assert.match(AHORA_TAB_NOTE, /cobrado este mes/);
  assert.match(PERIODO_TAB_NOTE, /este mes, el mes anterior y el total/i);
  assert.equal(
    seguimientosHeader("Todo al día", "USD 531"),
    "Todo al día · Saldo por cobrar USD 531",
  );
  assert.doesNotMatch(seguimientosHeader("Todo al día", "USD 531"), /cobrado/i);
});
