import assert from "node:assert/strict";
import { test } from "node:test";
import { answerCrmFollowups } from "./crm-ask";
import { buildCrmBoard, pagoLabel, type CrmBoardCall, type CrmBoardFollowup } from "./crm-board";
import { compareFollowupRank, followupRankInput } from "./crm-followups";

const NOW = new Date("2026-10-05T01:00:00Z");

function followup(partial: Partial<CrmBoardFollowup> & { id: string; cliente: string }): CrmBoardFollowup {
  return {
    dueAt: "2026-10-04T15:00:00.000Z",
    proximo: "2026-10-04",
    hilo: "SEGUIMIENTO",
    oferta: "Círculo Millonario",
    ...partial,
  };
}

test("hoy matches the shared rank and skips a later date", () => {
  const followups: CrmBoardFollowup[] = [
    followup({ id: "j", cliente: "Jessica Pajuelo", proximo: "2026-09-23", dueAt: "2026-09-23T13:00:00.000Z", enJuego: 0 }),
    followup({ id: "e", cliente: "Elber", proximo: "2026-09-23", dueAt: "2026-09-23T18:00:00.000Z", hilo: "DECISION", enJuego: 0 }),
    followup({ id: "n", cliente: "Néstor Mollehuara", proximo: "2026-09-25", dueAt: "2026-09-25T15:00:00.000Z", enJuego: 0 }),
    followup({ id: "later", cliente: "Paula Ríos", proximo: "2026-10-20", dueAt: "2026-10-20T15:00:00.000Z", enJuego: 900 }),
  ];
  const board = buildCrmBoard({ calls: [], followups, period: "todo", now: NOW });
  const hoy = board.hoy.map((row) => row.name);
  const ranked = [...followups].sort((a, b) =>
    compareFollowupRank(followupRankInput(a, NOW), followupRankInput(b, NOW)),
  );
  assert.deepEqual(hoy, ["Elber", "Jessica Pajuelo", "Néstor Mollehuara"]);
  assert.equal(hoy.includes("Paula Ríos"), false);
  assert.deepEqual(board.rows.map((row) => row.name), ["Paula Ríos"]);
  assert.equal(board.restTitle, "Más adelante");
  assert.deepEqual(
    [...board.hoy.map((row) => row.name), ...board.rows.map((row) => row.name)],
    ranked.map((row) => row.cliente),
  );
  const asked = answerCrmFollowups(
    followups.map((row) => ({
      id: row.id,
      cliente: row.cliente,
      dueAt: row.dueAt || "",
      proximo: row.proximo,
      hilo: row.hilo,
      enJuego: row.enJuego,
    })),
    "¿A quién llamo hoy?",
    { now: NOW },
  );
  const names = [...asked.matchAll(/^• ([^·\n]+)/gm)].map((match) => match[1].trim());
  assert.deepEqual(names, hoy);
  assert.match(board.hoyNote, /3 personas para hoy/);
  assert.match(board.hoyNote, /4 personas en seguimiento/);
  assert.equal(board.hoy.some((row) => /vencid|temperatura|paso 1 de|fila/i.test(`${row.chip?.label} ${row.pago}`)), false);
  assert.equal(board.hoy.some((row) => /\d{4}-\d{2}-\d{2}/.test(row.chip?.label || "")), false);
  const searched = buildCrmBoard({ calls: [], followups, period: "todo", query: "Paula", now: NOW });
  assert.deepEqual(searched.hoy.map((row) => row.name), hoy);
  assert.deepEqual(searched.rows.map((row) => row.name), ["Paula Ríos"]);
});

test("buckets keep a closed sale, a lost lead and an open follow-up apart", () => {
  const calls: CrmBoardCall[] = [
    {
      id: "c1",
      cliente: "Ana Salas",
      fecha: "2026-10-02",
      estadoAgenda: "CIERRE VENTA",
      leadStatus: "cerrado",
      cash: 900,
      oferta: "Fertilidad Consciente",
    },
    {
      id: "p1",
      cliente: "Marco Ruiz",
      fecha: "2026-09-12",
      leadStatus: "perdido",
      seguimientoResultado: "perdido",
      oferta: "Círculo Millonario",
    },
  ];
  const followups = [
    followup({ id: "d", cliente: "Diego Paredes", proximo: "2026-10-04 15:00", enJuego: 0, oferta: "Círculo Millonario" }),
  ];
  const board = buildCrmBoard({ calls, followups, period: "todo", now: NOW });
  assert.deepEqual(board.hoy.map((row) => row.name), ["Diego Paredes"]);
  assert.deepEqual(board.rows.map((row) => row.name), []);
  assert.match(board.empty, /A quién contactar hoy/);
  assert.equal(board.counts.seguimiento, 1);
  assert.equal(board.counts.cerrados, 1);
  assert.equal(board.counts.perdidos, 1);
  const closed = buildCrmBoard({ calls, followups, period: "todo", bucket: "cerrados", now: NOW });
  assert.equal(closed.rows[0]?.pago, "Pagó USD 900");
  assert.equal(closed.rows[0]?.chip?.label, "Cerró");
  const lost = buildCrmBoard({ calls, followups, period: "todo", bucket: "perdidos", now: NOW });
  assert.equal(lost.rows[0]?.name, "Marco Ruiz");
  assert.equal(lost.rows[0]?.pago, "Sin pago");
});

test("este mes keeps an overdue follow-up and a cierre from another month stays out", () => {
  const calls: CrmBoardCall[] = [
    {
      id: "old",
      cliente: "Sofía León",
      fecha: "2026-09-02",
      estadoAgenda: "CIERRE VENTA",
      leadStatus: "cerrado",
      cash: 180,
    },
    {
      id: "now",
      cliente: "Lucía Vega",
      fecha: "2026-10-01",
      estadoAgenda: "CIERRE VENTA",
      leadStatus: "cerrado",
      cash: 80,
    },
  ];
  const followups = [
    followup({ id: "late", cliente: "Elber", proximo: "2026-09-23", dueAt: "2026-09-23T18:00:00.000Z" }),
  ];
  const month = buildCrmBoard({ calls, followups, period: "mes", now: NOW });
  assert.deepEqual(month.hoy.map((row) => row.name), ["Elber"]);
  assert.equal(month.counts.seguimiento, 1);
  assert.equal(month.counts.cerrados, 1);
  const closed = buildCrmBoard({ calls, followups, period: "mes", bucket: "cerrados", now: NOW });
  assert.deepEqual(closed.rows.map((row) => row.name), ["Lucía Vega"]);
  assert.match(month.subtitle, /1 persona cerró este mes/);
  assert.match(month.subtitle, /USD 80 cobrados/);
  assert.equal(month.counts.cerrados, 1);
});

test("en seguimiento matches Inicio and a call this month is not a cierre", () => {
  const calls: CrmBoardCall[] = [
    { id: "a", cliente: "Ana Salas", fecha: "2026-10-02", estadoAgenda: "SHOW", oferta: "Círculo Millonario" },
    { id: "b", cliente: "Luis Gómez", fecha: "2026-10-03", estadoAgenda: "SHOW" },
  ];
  const followups = [
    followup({ id: "late", cliente: "Elber", proximo: "2026-09-23" }),
    followup({ id: "later", cliente: "Paula Ríos", proximo: "2026-11-02", dueAt: "2026-11-02T15:00:00.000Z" }),
  ];
  const board = buildCrmBoard({ calls, followups, period: "mes", now: NOW });
  assert.equal(board.counts.cerrados, 0);
  assert.equal(board.counts.perdidos, null);
  assert.equal(board.subtitle, "");
  assert.equal(board.counts.seguimiento, 2);
  assert.match(board.hoyNote, /2 personas en seguimiento/);
  assert.equal(board.hoy.length + board.rows.length, board.counts.seguimiento);
  assert.deepEqual(board.hoy.map((row) => row.name), ["Elber"]);
  assert.deepEqual(board.rows.map((row) => row.name), ["Paula Ríos"]);
});

test("pago does not invent a quota or a zero", () => {
  assert.deepEqual(pagoLabel({ cash: 1597, saldo: 400 }, (n) => `USD ${n}`), {
    pago: "Pagó USD 1597",
    note: "falta USD 400",
  });
  assert.deepEqual(pagoLabel({ cash: 0, saldo: 0 }, (n) => `USD ${n}`), { pago: "Sin pago", note: "" });
  assert.deepEqual(pagoLabel({ cash: null, saldo: null, modoPago: "CONTADO" }, (n) => `USD ${n}`), {
    pago: "Sin pago",
    note: "",
  });
  assert.equal(pagoLabel({ cash: 900, saldo: null, modoPago: "CONTADO" }, (n) => `USD ${n}`).note, "de contado");
  assert.equal(/cuota 2 de 3/i.test(JSON.stringify(pagoLabel({ cash: null, saldo: 100 }, (n) => `USD ${n}`))), false);
});

test("a close with an open follow-up still counts, and a bare list is sin datos", () => {
  const open = buildCrmBoard({
    now: NOW,
    period: "mes",
    calls: [
      {
        id: "c1",
        cliente: "Ana Salas",
        fecha: "2026-10-02",
        estadoAgenda: "CIERRE VENTA",
        cash: 900,
        oferta: "Fertilidad Consciente",
      },
    ],
    followups: [
      followup({
        id: "a",
        cliente: "Ana Salas",
        proximo: "2026-10-04",
        acuerdo: "Quedó en revisar la propuesta y dar una respuesta.",
      }),
    ],
  });
  assert.equal(open.counts.cerrados, 1);
  assert.equal(open.counts.seguimiento, 1);
  assert.equal(open.hoy[0]?.leftOff, "Quedó en revisar la propuesta y dar una respuesta.");
  const closed = buildCrmBoard({
    now: NOW,
    period: "mes",
    bucket: "cerrados",
    calls: [
      {
        id: "c1",
        cliente: "Ana Salas",
        fecha: "2026-10-02",
        estadoAgenda: "CIERRE VENTA",
        cash: 900,
      },
    ],
    followups: [followup({ id: "a", cliente: "Ana Salas", proximo: "2026-10-04" })],
  });
  assert.equal(closed.rows[0]?.name, "Ana Salas");

  const empty = buildCrmBoard({
    now: NOW,
    period: "mes",
    calls: [],
    followups: [followup({ id: "e", cliente: "Elber", proximo: "2026-09-23" })],
  });
  assert.equal(empty.counts.cerrados, null);
  assert.equal(empty.counts.perdidos, null);
  const lostView = buildCrmBoard({
    now: NOW,
    period: "mes",
    bucket: "perdidos",
    calls: [],
    followups: [followup({ id: "e", cliente: "Elber", proximo: "2026-09-23" })],
  });
  assert.match(lostView.empty, /Sin datos de perdidos/);
});

test("razon de no cierre is a perdido, the same signal Coach uses", () => {
  const board = buildCrmBoard({
    now: NOW,
    period: "mes",
    calls: [
      {
        id: "m",
        cliente: "Marco Ruiz",
        fecha: "2026-10-01",
        estadoAgenda: "SHOW",
        razonNoCierre: "lo habla con el socio",
      },
    ],
    followups: [],
  });
  assert.equal(board.counts.cerrados, 0);
  assert.equal(board.counts.perdidos, 1);
});
