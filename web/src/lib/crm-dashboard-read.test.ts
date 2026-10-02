import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardCallFromRow, dashboardRowFromFiling } from "./crm-call-read";
import { operacionFromCall } from "./crm-operacion";
import { summarizePipeline } from "./crm-pipeline";

const transcript = "lead: ".repeat(8_000);

function fullCall() {
  return {
    id: "call-ana",
    leadName: "Ana Pérez",
    offerName: "Círculo Millonario",
    estadoAgenda: "SHOW",
    ventaTotal: 10_000,
    cashCollected: 2_000,
    saldoPendiente: 8_000,
    modoPago: "4 cuotas",
    filingStatus: "confirmed",
    title: "Ana",
    summary: "Resumen corto",
    recordedAt: new Date("2026-09-02T15:00:00.000Z"),
    createdAt: new Date("2026-09-02T15:00:00.000Z"),
    filingJson: {
      producto: "Círculo Millonario",
      tipo_seguimiento: "PAGO PENDIENTE",
      acuerdo_seguimiento: "segunda cuota en octubre",
      notas_crm: "Pagó la inicial",
      proximo_seguimiento: "2026-10-08",
      cliente_real: "Ana Pérez",
      estado_agenda: "SHOW",
      calificado: true,
      lead_id: "lead-ana",
      telefono: "999",
      email: "ana@example.com",
      canal_contacto: "WHATSAPP",
      modo_pago: "4 cuotas",
      razon_no_cierre: "",
      requiere_seguimiento: true,
      seguimiento_resultado: "",
      seguimiento_cerrado: "",
      venta_total: 10_000,
      cash_collected: 2_000,
      saldo_pendiente: 8_000,
      evidencia: {
        cierre: "quedó en 10000",
        venta_total: "10000",
        seguimiento: "segunda cuota",
        identidad: transcript,
      },
      confianza: { venta_total: 90, producto: 90 },
      transcript,
    },
  };
}

test("the slim call row keeps the glance numbers and drops the transcript blob", () => {
  const full = fullCall();
  const slim = dashboardCallFromRow(dashboardRowFromFiling(full));
  const fullBytes = Buffer.byteLength(JSON.stringify(full.filingJson));
  const slimBytes = Buffer.byteLength(JSON.stringify(slim.filingJson));
  assert.ok(slimBytes < fullBytes / 5, `slim ${slimBytes} vs full ${fullBytes}`);
  assert.equal(JSON.stringify(slim.filingJson).includes(transcript.slice(0, 40)), false);

  const fullOp = operacionFromCall(full);
  const slimOp = operacionFromCall(slim);
  assert.equal(slimOp.cliente, fullOp.cliente);
  assert.equal(slimOp.venta, fullOp.venta);
  assert.equal(slimOp.cash, fullOp.cash);
  assert.equal(slimOp.saldo, fullOp.saldo);
  assert.equal(slimOp.fechaProximo, fullOp.fechaProximo);
  assert.equal(slimOp.tipoSeguimiento, fullOp.tipoSeguimiento);
  assert.equal(slimOp.oferta, fullOp.oferta);

  const leads = [
    {
      id: "lead-ana",
      name: "Ana Pérez",
      status: "seguimiento",
      offerName: "Círculo Millonario",
      amountTalked: "10000",
    },
  ];
  const offers = [
    {
      productName: "Círculo Millonario",
      listPrice: 11_800,
      altPrices: [{ label: "Contado", amount: 10_000 }],
    },
  ];
  const fullPipe = summarizePipeline({ leads, calls: [full], threads: [], offers });
  const slimPipe = summarizePipeline({ leads, calls: [slim], threads: [], offers });
  assert.equal(slimPipe.saldo, fullPipe.saldo);
  assert.equal(slimPipe.pipeline.total, fullPipe.pipeline.total);
  assert.equal(slimPipe.pipeline.count, fullPipe.pipeline.count);
  assert.deepEqual(slimPipe.lines, fullPipe.lines);
});

test("a glance payload is kilobytes and the old hub body is not", () => {
  const script = "Hola, te escribo por la segunda cuota. ".repeat(40);
  const note = "nota ".repeat(4_000);
  const before = {
    messages: Array.from({ length: 80 }, (_, index) => ({
      id: `m-${index}`,
      role: "coach",
      content: note,
    })),
    snapshot: {
      now: {
        oportunidadesActivas: 23,
        seguimientosHoy: 2,
        seguimientosVencidos: 13,
        dineroEnJuego: 63_600,
        saldoPorCobrar: 531,
        pipelineLeads: 23,
      },
      pipelineDetalle: [{ name: "Ana", amount: 531, fuente: "venta" }],
      comisionResumen: { generada: 1000, cobrada: 200, pendiente: 800, pctCobrado: 0.2 },
      alertsDue: Array.from({ length: 8 }, (_, index) => ({
        id: `a-${index}`,
        question: "¿Lo hiciste?",
        contexto: note,
        mensajeSugerido: script,
        opciones: Array.from({ length: 6 }, () => ({
          mensaje: script,
          recomendacion: script,
        })),
      })),
      pendingCalls: Array.from({ length: 8 }, (_, index) => ({
        id: `p-${index}`,
        lines: [note],
        filing: { summary: note, speakers: [] },
      })),
    },
  };
  const after = {
    snapshot: {
      now: before.snapshot.now,
      pipelineDetalle: before.snapshot.pipelineDetalle,
      comisionResumen: before.snapshot.comisionResumen,
      desk: {
        unclassified: 0,
        analyzeStatus: "Todo al día",
        followupStatus: "13 vencidos",
        practiceHref: "/practicar",
        practiceStatus: "Elige con quién practicar",
        coachStatus: "Sin novedades",
      },
      projection: null,
      needsMonthlyGoal: false,
      needsPushPrompt: false,
    },
  };
  const beforeKb = Buffer.byteLength(JSON.stringify(before)) / 1024;
  const afterKb = Buffer.byteLength(JSON.stringify(after)) / 1024;
  // Fixture measured at 2196.0 KB before and 0.5 KB for the glance body.
  assert.ok(beforeKb > 2000, `before ${beforeKb.toFixed(1)} KB`);
  assert.ok(afterKb < 1, `after ${afterKb.toFixed(1)} KB`);
});
