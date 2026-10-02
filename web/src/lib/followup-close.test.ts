import assert from "node:assert/strict";
import { test } from "node:test";
import { enrichExtractorFollowup, parseExtractorJson } from "./extractor";
import { followupIsClosed, followupSnapshot } from "./crm-followups";
import {
  normalizeFollowupWhen,
  projectDeskRows,
  projectOperacionProximo,
  suggestNextFollowup,
} from "./followup-desk";

const today = "2026-10-02";

test("no contestó suggests tomorrow and keeps the clock", () => {
  assert.equal(suggestNextFollowup(today, "2026-10-02 10:00"), "2026-10-03 10:00");
  assert.equal(suggestNextFollowup(today, "2026-10-02"), "2026-10-03");
  assert.equal(normalizeFollowupWhen("2026-10-08", "2026-10-02 10:00"), "2026-10-08 10:00");
  assert.equal(normalizeFollowupWhen("ayer", "2026-10-02"), null);
});

test("hecho drops the row and the money from today's counters", () => {
  const rows = [
    {
      id: "carlos",
      dueAt: "2026-10-02T12:00:00.000Z",
      estado: "HOY",
      days: 0,
      enJuego: 10000,
      proximaAccion: "cobrar la reserva · pendiente de hoy",
      proximo: "2026-10-02 10:00",
      closesOnHecho: true,
      nextOnHecho: "",
    },
    {
      id: "ricardo",
      dueAt: "2026-09-26T12:00:00.000Z",
      estado: "VENCIDO",
      days: 6,
      enJuego: 0,
      proximaAccion: "confirmar la reunión · vencido",
      closesOnHecho: true,
      nextOnHecho: "",
    },
  ];
  const next = projectDeskRows(rows, { targetId: "carlos", action: "hecho", today });
  assert.equal(next.leaves, true);
  assert.equal(next.rows.length, 1);
  assert.equal(next.rows[0]?.id, "ricardo");
  const counts = followupSnapshot(next.rows);
  assert.equal(counts.seguimientosHoy, 0);
  assert.equal(counts.seguimientosVencidos, 1);
  assert.equal(counts.dineroEnJuego, 0);
});

test("no contestó keeps the lead and moves the day", () => {
  const rows = [
    {
      id: "sofia",
      dueAt: "2026-10-02T12:00:00.000Z",
      estado: "HOY",
      days: 0,
      enJuego: 10000,
      proximaAccion: "seguimiento · pendiente de hoy",
      proximo: "2026-10-02 09:00",
      closesOnHecho: true,
      nextOnHecho: "",
    },
  ];
  const next = projectDeskRows(rows, {
    targetId: "sofia",
    action: "no_contesto",
    today,
    nextAt: "2026-10-03",
  });
  assert.equal(next.leaves, false);
  assert.equal(next.proximo, "2026-10-03 09:00");
  assert.equal(next.rows[0]?.estado, "PRÓXIMO");
  assert.equal(followupSnapshot(next.rows).seguimientosHoy, 0);
  assert.equal(followupSnapshot(next.rows).dineroEnJuego, 10000);
});

test("hecho with a next step stays pending on that date", () => {
  const rows = [
    {
      id: "decision",
      dueAt: "2026-10-02T12:00:00.000Z",
      estado: "HOY",
      days: 0,
      enJuego: 5000,
      proximaAccion: "enviar mensaje · pendiente de hoy",
      closesOnHecho: false,
      nextOnHecho: "2026-10-04",
    },
  ];
  const next = projectDeskRows(rows, { targetId: "decision", action: "hecho", today });
  assert.equal(next.leaves, false);
  assert.equal(next.rows[0]?.estado, "PRÓXIMO");
  assert.equal(next.proximo, "2026-10-04");
  assert.equal(followupSnapshot(next.rows).seguimientosHoy, 0);
  assert.equal(followupSnapshot(next.rows).dineroEnJuego, 5000);
});

test("closing a lead clears every próximo so Operación and Seguimientos agree", () => {
  const rows = projectOperacionProximo(
    [
      { id: "new", cliente: "Carlos Ramírez", fechaProximo: "2026-10-02 10:00" },
      { id: "old", cliente: "Carlos Ramirez", fechaProximo: "2026-09-02" },
      { id: "other", cliente: "Ana", fechaProximo: "2026-10-04" },
    ],
    {
      callId: "new",
      cliente: "Carlos Ramírez",
      proximo: "",
      resultado: "hecho",
      closeAll: true,
    },
  );
  assert.equal(rows[0]?.fechaProximo, "");
  assert.equal(
    (rows[0] as { seguimientoCerrado?: boolean } | undefined)?.seguimientoCerrado,
    true,
  );
  assert.equal(rows[1]?.fechaProximo, "");
  assert.equal(rows[2]?.fechaProximo, "2026-10-04");
});

test("a closed follow-up is not reopened from the transcript", () => {
  const parsed = parseExtractorJson({
    cliente_real: "Carlos Ramírez",
    estado_agenda: "SHOW",
    requiere_seguimiento: false,
    proximo_seguimiento: "",
    seguimiento_resultado: "hecho",
    seguimiento_cerrado: "2026-10-02 10:00",
    seguimiento_intentos: 1,
    seguimiento_undo: { calls: [] },
    confianza: {
      cliente_real: 95,
      estado_agenda: 95,
      requiere_seguimiento: 95,
      proximo_seguimiento: 95,
    },
  });
  assert.equal(followupIsClosed(parsed), true);
  assert.equal(parsed.seguimiento_cerrado, "2026-10-02 10:00");
  assert.deepEqual(parsed.seguimiento_undo, { calls: [] });
  enrichExtractorFollowup(parsed, {
    transcript: "seguimiento viernes 2 de octubre a las 10 am",
    callAt: new Date("2026-09-30T15:00:00.000Z"),
  });
  assert.equal(parsed.proximo_seguimiento, null);
  assert.equal(parsed.requiere_seguimiento, false);
});
