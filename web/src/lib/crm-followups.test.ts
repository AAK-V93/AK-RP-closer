import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alignFollowups,
  applyClosedSaleFollowup,
  shownFollowupKind,
  deskLinesFromFilings,
  followupSnapshot,
  formatPendingDesk,
  formatPendingToday,
  formatWhoToCall,
  isMeetingFollowup,
  moneyInPlay,
  type OperacionFollowupSource,
} from "./crm-followups";
import { zonedDayKey } from "./crm-time";

function source(
  partial: Partial<OperacionFollowupSource> &
    Pick<OperacionFollowupSource, "id" | "cliente" | "fechaProximo">,
): OperacionFollowupSource {
  return {
    fecha: "2026-09-20",
    oferta: "Círculo Millonario",
    telefono: "",
    venta: null,
    cash: null,
    saldo: null,
    acuerdo: "",
    tipoSeguimiento: "",
    ...partial,
  };
}

test("Bogotá day is the day before UTC in the early morning", () => {
  assert.equal(zonedDayKey(new Date("2026-10-02T02:00:00.000Z")), "2026-10-01");
  assert.equal(zonedDayKey(new Date("2026-10-02T07:00:00.000Z")), "2026-10-02");
});

test("money in play is the open sale, not a phone number and not cash already collected", () => {
  assert.equal(moneyInPlay({ venta: 10000, cash: 0, saldo: null }), 10000);
  assert.equal(moneyInPlay({ venta: 10000, cash: 0, saldo: 10000 }), 10000);
  assert.equal(moneyInPlay({ venta: 10000, cash: 10000, saldo: 0 }), 0);
  assert.equal(moneyInPlay({ venta: 51_945_678_123, cash: 0, saldo: null }), 0);
});

test("on 1 Oct, today's two operación rows count and Ricardo's overdue date does not", () => {
  const today = "2026-10-01";
  const rows = alignFollowups(
    [
      {
        id: "alert-ricardo",
        cliente: "Ricardo Verastegui",
        dueAt: "2026-10-01T15:00:00.000Z",
        estado: "HOY",
        days: 0,
        enJuego: 0,
        proximaAccion: "confirmar la reunión · pendiente de hoy",
        acuerdo: "confirmar la reunión",
      },
    ],
    [
      source({
        id: "c-ricardo",
        cliente: "Ricardo Verastegui",
        fechaProximo: "2026-09-26",
      }),
      source({
        id: "c-kimlen",
        cliente: "Kimlen Garcia",
        fechaProximo: "2026-10-01",
        acuerdo: "escribir",
      }),
      source({
        id: "c-alfredo",
        cliente: "Alfredo y Felipe",
        fechaProximo: "2026-10-01",
        acuerdo: "llamar",
      }),
      source({
        id: "c-carlos",
        cliente: "Carlos Ramírez",
        fechaProximo: "2026-10-02 10:00",
        venta: 10000,
        cash: 0,
        saldo: 10000,
        acuerdo: "cobrar la reserva",
      }),
      source({ id: "c-daymer", cliente: "Daymer", fechaProximo: "2026-09-23" }),
      source({
        id: "c-maria",
        cliente: "Maria Leydis Palacios Murillo",
        fechaProximo: "2026-09-30",
      }),
      source({ id: "c-elber", cliente: "Elber", fechaProximo: "2026-09-23" }),
    ],
    today,
    (draft) => ({
      id: `call:${draft.source.id}`,
      cliente: draft.source.cliente,
      dueAt: draft.dueAt,
      estado: draft.estado,
      days: Math.max(0, draft.days),
      enJuego: draft.enJuego,
      proximaAccion: draft.proximaAccion,
      acuerdo: draft.source.acuerdo,
    }),
  );

  const byName = new Map(rows.map((row) => [row.cliente, row]));
  assert.equal(byName.size, 7);
  assert.equal(byName.get("Ricardo Verastegui")?.estado, "VENCIDO");
  assert.equal(byName.get("Ricardo Verastegui")?.id, "alert-ricardo");
  assert.equal(
    byName.get("Ricardo Verastegui")?.proximaAccion,
    "confirmar la reunión · vencido",
  );
  assert.equal(byName.get("Kimlen Garcia")?.estado, "HOY");
  assert.equal(byName.get("Alfredo y Felipe")?.estado, "HOY");
  assert.equal(byName.get("Carlos Ramírez")?.estado, "PRÓXIMO");
  assert.equal(byName.get("Carlos Ramírez")?.enJuego, 10000);
  assert.equal(byName.get("Daymer")?.estado, "VENCIDO");
  assert.equal(byName.get("Elber")?.estado, "VENCIDO");

  const counts = followupSnapshot(rows);
  assert.equal(counts.seguimientosHoy, 2);
  assert.equal(counts.seguimientosVencidos, 4);
  assert.equal(counts.dineroEnJuego, 10000);
});

test("on 2 Oct Carlos is pendiente de hoy and the test leads are in the list", () => {
  const today = "2026-10-02";
  const rows = alignFollowups(
    [
      {
        id: "alert-ricardo",
        cliente: "Ricardo Verástegui",
        dueAt: "2026-10-02T12:00:00.000Z",
        estado: "HOY",
        days: 0,
        enJuego: 0,
        proximaAccion: "confirmar la reunión · vencido",
        acuerdo: "",
      },
    ],
    [
      source({
        id: "r",
        cliente: "Ricardo Verastegui",
        fechaProximo: "2026-09-26",
      }),
      source({
        id: "carlos",
        cliente: "Carlos Ramírez",
        fechaProximo: "2026-10-02 10:00",
        venta: 10000,
        saldo: 10000,
      }),
      source({
        id: "sofia",
        cliente: "Sofía Mamani",
        fechaProximo: "2026-10-08 09:00",
        venta: 10000,
      }),
      source({
        id: "diego",
        cliente: "Diego Huamán",
        fechaProximo: "2026-10-07 15:00",
        venta: 10000,
      }),
      source({
        id: "andrea",
        cliente: "Andrea Quispe",
        fechaProximo: "2026-10-06 11:00",
        venta: 10000,
      }),
      source({
        id: "lucia",
        cliente: "Lucía Torres",
        fechaProximo: "2026-10-05 16:00",
        venta: 10000,
      }),
    ],
    today,
    (draft) => ({
      id: `call:${draft.source.id}`,
      cliente: draft.source.cliente,
      dueAt: draft.dueAt,
      estado: draft.estado,
      days: Math.max(0, draft.days),
      enJuego: draft.enJuego,
      proximaAccion: draft.proximaAccion,
      acuerdo: draft.source.acuerdo,
    }),
  );
  const byName = new Map(rows.map((row) => [row.cliente, row]));
  assert.equal(rows.length, 6);
  assert.equal(byName.get("Ricardo Verástegui")?.estado, "VENCIDO");
  assert.match(
    byName.get("Ricardo Verástegui")?.proximaAccion || "",
    /vencido/,
  );
  assert.doesNotMatch(
    byName.get("Ricardo Verástegui")?.proximaAccion || "",
    /pendiente de hoy/,
  );
  assert.equal(byName.get("Carlos Ramírez")?.estado, "HOY");
  assert.match(
    byName.get("Carlos Ramírez")?.proximaAccion || "",
    /pendiente de hoy/,
  );
  for (const name of [
    "Sofía Mamani",
    "Diego Huamán",
    "Andrea Quispe",
    "Lucía Torres",
  ]) {
    assert.equal(byName.get(name)?.estado, "PRÓXIMO");
    assert.equal(byName.get(name)?.enJuego, 10000);
  }
  const counts = followupSnapshot(rows);
  assert.equal(counts.seguimientosHoy, 1);
  assert.equal(counts.dineroEnJuego, 50000);
});

test("Carlos Ramírez (QA) counts once, and a year is not money in play", () => {
  assert.equal(moneyInPlay({ venta: 2026, cash: 0, saldo: null, at: "2026-09-30" }), 0);
  assert.equal(moneyInPlay({ venta: 51945678123, cash: 0, saldo: null }), 0);
  const rows = alignFollowups(
    [],
    [
      source({
        id: "qa",
        cliente: "Carlos Ramírez (QA)",
        fecha: "2026-09-30",
        fechaProximo: "2026-10-02",
        venta: 10000,
        saldo: 10000,
      }),
      source({
        id: "orig",
        cliente: "Carlos Ramírez",
        fecha: "2026-09-20",
        fechaProximo: "2026-10-01",
        venta: 10000,
        saldo: 10000,
      }),
    ],
    "2026-10-02",
    (draft) => ({
      id: draft.source.id,
      cliente: draft.source.cliente,
      dueAt: draft.dueAt,
      estado: draft.estado,
      days: 0,
      enJuego: draft.enJuego,
      proximaAccion: draft.proximaAccion,
    }),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, "qa");
  assert.equal(rows[0]?.enJuego, 10000);
  assert.equal(followupSnapshot(rows).dineroEnJuego, 10000);
});

test("the latest call with a date wins when the same lead has two", () => {
  const rows = alignFollowups(
    [],
    [
      source({
        id: "new",
        cliente: "Carlos Ramírez",
        fecha: "2026-10-01",
        fechaProximo: "2026-10-08",
      }),
      source({
        id: "old",
        cliente: "Carlos Ramirez",
        fecha: "2026-09-01",
        fechaProximo: "2026-09-02",
      }),
    ],
    "2026-10-02",
    (draft) => ({
      id: draft.source.id,
      cliente: draft.source.cliente,
      dueAt: draft.dueAt,
      estado: draft.estado,
      days: 0,
      enJuego: 0,
      proximaAccion: draft.proximaAccion,
    }),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.dueAt.slice(0, 10), "2026-10-08");
  assert.equal(rows[0]?.estado, "PRÓXIMO");
});

test("a follow-up without a client is not a lead", () => {
  const rows = alignFollowups(
    [],
    [
      source({ id: "blank", cliente: "", fechaProximo: "2026-09-30" }),
      source({ id: "named", cliente: "Ana", fechaProximo: "2026-10-02" }),
    ],
    "2026-10-02",
    (draft) => ({
      id: draft.source.id,
      cliente: draft.source.cliente,
      dueAt: draft.dueAt,
      estado: draft.estado,
      days: 0,
      enJuego: 0,
      proximaAccion: draft.proximaAccion,
    }),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.cliente, "Ana");
});

test("closing the latest call does not bring back an older date", () => {
  const rows = alignFollowups(
    [],
    [
      source({
        id: "new",
        cliente: "Carlos Ramírez",
        fechaProximo: "",
        seguimientoCerrado: true,
      }),
      source({
        id: "old",
        cliente: "Carlos Ramirez",
        fechaProximo: "2026-09-02",
      }),
    ],
    "2026-10-02",
    (draft) => ({
      id: draft.source.id,
      cliente: draft.source.cliente,
      dueAt: draft.dueAt,
      estado: draft.estado,
      days: 0,
      enJuego: 0,
      proximaAccion: draft.proximaAccion,
    }),
  );
  assert.equal(rows.length, 0);
});

test("meeting follow-ups are segunda reunión, not a decision call", () => {
  assert.equal(isMeetingFollowup("SEGUNDA REUNION"), true);
  assert.equal(isMeetingFollowup("SEGUNDA_REUNION"), true);
  assert.equal(isMeetingFollowup("REUNION"), true);
  assert.equal(isMeetingFollowup("DECISION"), false);
  assert.equal(isMeetingFollowup("RETOMAR"), false);
  assert.equal(isMeetingFollowup("PAGO PENDIENTE"), false);
});

test("a closed sale with balance is cobro, and the repeated description is dropped", () => {
  const row = applyClosedSaleFollowup({
    id: "valeria",
    cliente: "Valeria Ríos",
    dueAt: "2026-10-09T17:00:00.000Z",
    estado: "PRÓXIMO",
    days: 7,
    enJuego: 1064,
    proximaAccion: "Llamada de seguimiento para ver cómo arranca el programa.",
    contexto: "Llamada de seguimiento para ver cómo arranca el programa.",
    tipo: "SEGUNDA REUNION",
    hilo: "SEGUNDA REUNION",
    estadoAgenda: "CIERRE VENTA",
    leadStatus: "cerrado",
  });
  assert.equal(row.tipo, "PAGO PENDIENTE");
  assert.equal(row.hilo, "COBRANZA");
  assert.equal(row.proximaAccion, "cobrar la siguiente cuota");
  assert.equal(row.contexto, "");
  const paid = applyClosedSaleFollowup({ ...row, enJuego: 0, tipo: "SEGUNDA REUNION", hilo: "SEGUNDA_REUNION" });
  assert.equal(paid.tipo, "ONBOARDING");
  assert.equal(paid.proximaAccion, "dar la bienvenida");
  assert.equal(
    shownFollowupKind(
      {
        tipoSeguimiento: "SEGUNDA REUNION",
        estadoAgenda: "CIERRE VENTA",
        leadStatus: "cerrado",
        venta: 1597,
        cash: 533,
        saldo: 1064,
      },
      {
        tipo: "SEGUNDA REUNION",
        hilo: "SEGUNDA REUNION",
        enJuego: 1064,
        proximaAccion: "cobrar la siguiente cuota",
      },
    ),
    "COBRANZA",
  );
  assert.equal(
    shownFollowupKind({
      tipoSeguimiento: "SEGUNDA REUNION",
      estadoAgenda: "CIERRE VENTA",
      leadStatus: "cerrado",
      saldo: 1064,
    }),
    "COBRANZA",
  );
});

test("the desk ranks money ahead of an older call and never says only seguimiento", () => {
  const lines = deskLinesFromFilings(
    [
      {
        name: "Valeria Ríos",
        proximo: "2026-10-02 17:00",
        step: "SEGUNDA REUNION",
        closed: false,
        estadoAgenda: "CIERRE VENTA",
        venta: 1597,
        cash: 533,
        saldo: 1064,
        note: "seguimiento",
      },
      {
        name: "Carlos Ramírez",
        proximo: "2026-09-20",
        step: "DECISION",
        closed: false,
        note: "prometió decidir el viernes",
        lastContact: "2026-09-20",
      },
      {
        name: "Ana Quispe",
        proximo: "2026-09-29",
        step: "SEGUIMIENTO",
        closed: false,
        lastContact: "2026-09-28",
      },
      {
        name: "Lucía",
        proximo: "2026-10-20",
        step: "DECISION",
        closed: false,
      },
    ],
    "2026-10-02",
  );
  assert.equal(lines.length, 3);
  assert.equal(lines[0]?.name, "Valeria Ríos");
  assert.equal(lines[0]?.reason, "cuota de 1.064 vence hoy");
  assert.equal(lines[1]?.name, "Carlos Ramírez");
  assert.equal(lines[1]?.reason, "prometió decidir el viernes");
  assert.match(lines[2]?.reason || "", /último contacto el 28\/9\/2026/);
  for (const line of lines) {
    assert.notEqual(line.reason.trim().toLowerCase(), "seguimiento");
  }
  const today = formatPendingToday(lines, 8);
  const calls = formatWhoToCall(lines);
  assert.match(today, /1 seguimiento vencido|2 seguimientos vencidos|3 seguimientos vencidos/);
  assert.match(today, /8 llamadas por clasificar/);
  assert.match(today, /Valeria Ríos \(cuota de 1\.064 vence hoy\)/);
  assert.match(calls, /^Llama hoy, en este orden:/);
  assert.match(calls, /1\. Valeria Ríos\. Cuota de 1\.064 vence hoy\./);
  assert.match(calls, /2\. Carlos Ramírez\. Prometió decidir el viernes\./);
  assert.notEqual(today, calls);
  assert.equal(formatPendingDesk(lines, 8), today);
});
