import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("the dashboard call query is one indexed read without the transcript", () => {
  const src = readFileSync(new URL("./crm-call-read.ts", import.meta.url), "utf8");
  assert.equal(src.includes("transcriptText"), false);
  assert.equal(src.includes("transcriptJson"), false);
  const query = src.slice(src.indexOf("async function selectDashboardCalls"));
  assert.match(query, /LIMIT 2000/);
  assert.match(query, /filingStatus" <> 'skipped'/);
  assert.match(query, /recordedAt" DESC/);
  assert.equal((src.match(/\$queryRaw/g) || []).length, 1);
  const loader = src.slice(src.indexOf("export async function loadDashboardCalls"));
  assert.equal(loader.includes("Promise.all"), false);
});
