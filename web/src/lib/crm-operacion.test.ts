import assert from "node:assert/strict";
import { test } from "node:test";
import { moneyLabel, operacionFromCall, pctLabel } from "./crm-operacion";

test("operacion row prefers indexed money and ungated filing notes", () => {
  const row = operacionFromCall(
    {
      id: "c1",
      recordedAt: new Date("2026-09-10T15:00:00Z"),
      leadName: "Ana Pérez",
      offerName: "Mentoría",
      estadoAgenda: "CIERRE VENTA",
      ventaTotal: 4800,
      cashCollected: 1300,
      saldoPendiente: 3500,
      modoPago: "reserva",
      summary: "",
      filingStatus: "confirmed",
      filingJson: {
        telefono: "+57 300 000 0000",
        email: "ana@correo.com",
        canal_contacto: "zoom",
        producto: "MENTORIAS",
        notas_crm: "Pagó reserva, saldo el 15",
        requiere_seguimiento: true,
        tipo_seguimiento: "PAGO PENDIENTE",
        acuerdo_seguimiento: "Cobrar saldo el 15",
        proximo_seguimiento: "2026-09-15",
        calificado: true,
        venta_total: 1,
      },
    },
    { razonNoCierre: "" },
  );
  assert.equal(row.cliente, "Ana Pérez");
  assert.equal(row.oferta, "Mentoría");
  assert.equal(row.producto, "MENTORIAS");
  assert.equal(row.venta, 4800);
  assert.equal(row.cash, 1300);
  assert.equal(row.requiereSeguimiento, "SI");
  assert.equal(row.tipoSeguimiento, "PAGO PENDIENTE");
  assert.equal(row.fechaProximo, "2026-09-15");
  assert.match(row.notas, /reserva/);
  assert.equal(row.canal, "ZOOM");
});

test("money and pct labels", () => {
  assert.equal(moneyLabel(1300), "USD 1.300");
  assert.equal(moneyLabel(null), "—");
  assert.equal(pctLabel(0.42), "42%");
});
