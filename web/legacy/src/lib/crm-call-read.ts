import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Columns the dashboard math actually reads. The rest of filingJson
 * (confianza, identidad, undo blobs) stays in Postgres.
 */
const CALL_COLUMNS = Prisma.sql`
  id,
  "leadName",
  "offerName",
  "estadoAgenda",
  "ventaTotal",
  "cashCollected",
  "saldoPendiente",
  "modoPago",
  "filingStatus",
  title,
  summary,
  "recordedAt",
  "createdAt",
  "filingJson"->>'producto' AS producto,
  "filingJson"->>'tipo_seguimiento' AS tipo_seguimiento,
  "filingJson"->>'acuerdo_seguimiento' AS acuerdo_seguimiento,
  "filingJson"->>'notas_crm' AS notas_crm,
  "filingJson"->>'proximo_seguimiento' AS proximo_seguimiento,
  "filingJson"->>'cliente_real' AS cliente_real,
  "filingJson"->>'estado_agenda' AS estado_agenda,
  "filingJson"->>'calificado' AS calificado,
  "filingJson"->>'lead_id' AS lead_id,
  "filingJson"->>'telefono' AS telefono,
  "filingJson"->>'email' AS email,
  "filingJson"->>'canal_contacto' AS canal_contacto,
  "filingJson"->>'modo_pago' AS modo_pago,
  "filingJson"->>'razon_no_cierre' AS razon_no_cierre,
  "filingJson"->>'requiere_seguimiento' AS requiere_seguimiento,
  "filingJson"->>'seguimiento_resultado' AS seguimiento_resultado,
  "filingJson"->>'seguimiento_cerrado' AS seguimiento_cerrado,
  "filingJson"->'evidencia'->>'cierre' AS evidencia_cierre,
  "filingJson"->'evidencia'->>'venta_total' AS evidencia_venta,
  "filingJson"->'evidencia'->>'seguimiento' AS evidencia_seguimiento,
  "filingJson"->>'venta_total' AS venta_json,
  "filingJson"->>'cash_collected' AS cash_json,
  "filingJson"->>'saldo_pendiente' AS saldo_json,
  "filingJson"->'cobros' AS cobros
`;

export type DashboardCallRow = {
  id: string;
  leadName: string | null;
  offerName: string | null;
  estadoAgenda: string | null;
  ventaTotal: number | null;
  cashCollected: number | null;
  saldoPendiente: number | null;
  modoPago: string | null;
  filingStatus: string | null;
  title: string | null;
  summary: string | null;
  recordedAt: Date | string | null;
  createdAt: Date | string | null;
  producto: string | null;
  tipo_seguimiento: string | null;
  acuerdo_seguimiento: string | null;
  notas_crm: string | null;
  proximo_seguimiento: string | null;
  cliente_real: string | null;
  estado_agenda: string | null;
  calificado: string | boolean | null;
  lead_id: string | null;
  telefono: string | null;
  email: string | null;
  canal_contacto: string | null;
  modo_pago: string | null;
  razon_no_cierre: string | null;
  requiere_seguimiento: string | boolean | null;
  seguimiento_resultado: string | null;
  seguimiento_cerrado: string | null;
  evidencia_cierre: string | null;
  evidencia_venta: string | null;
  evidencia_seguimiento: string | null;
  venta_json: string | number | null;
  cash_json: string | number | null;
  saldo_json: string | number | null;
  cobros?: unknown;
};

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asNumber(value: number | string | null | undefined) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBool(value: string | boolean | null | undefined) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

/** Same filing keys the aggregators read, whether the row came from SQL or a full JSON. */
export function filingFromDashboardRow(row: DashboardCallRow) {
  return {
    producto: row.producto,
    tipo_seguimiento: row.tipo_seguimiento,
    acuerdo_seguimiento: row.acuerdo_seguimiento,
    notas_crm: row.notas_crm,
    proximo_seguimiento: row.proximo_seguimiento,
    cliente_real: row.cliente_real,
    estado_agenda: row.estado_agenda,
    calificado: asBool(row.calificado),
    lead_id: row.lead_id,
    telefono: row.telefono,
    email: row.email,
    canal_contacto: row.canal_contacto,
    modo_pago: row.modo_pago,
    razon_no_cierre: row.razon_no_cierre,
    requiere_seguimiento: asBool(row.requiere_seguimiento),
    seguimiento_resultado: row.seguimiento_resultado,
    seguimiento_cerrado: row.seguimiento_cerrado,
    venta_total: asNumber(row.venta_json),
    cash_collected: asNumber(row.cash_json),
    saldo_pendiente: asNumber(row.saldo_json),
    cobros: parseCobros(row.cobros),
    evidencia: {
      cierre: row.evidencia_cierre,
      venta_total: row.evidencia_venta,
      seguimiento: row.evidencia_seguimiento,
    },
  };
}

export function dashboardCallFromRow(row: DashboardCallRow) {
  return {
    id: row.id,
    leadName: row.leadName || "",
    offerName: row.offerName || "",
    estadoAgenda: row.estadoAgenda || "",
    ventaTotal: asNumber(row.ventaTotal),
    cashCollected: asNumber(row.cashCollected),
    saldoPendiente: asNumber(row.saldoPendiente),
    modoPago: row.modoPago || "",
    filingStatus: row.filingStatus || "",
    title: row.title || "",
    summary: row.summary || "",
    recordedAt: asDate(row.recordedAt),
    createdAt: asDate(row.createdAt) || new Date(0),
    filingJson: filingFromDashboardRow(row),
  };
}

/** Project a stored filing down to the SQL columns, dropping unused keys. */
export function dashboardRowFromFiling(call: {
  id: string;
  leadName?: string | null;
  offerName?: string | null;
  estadoAgenda?: string | null;
  ventaTotal?: number | null;
  cashCollected?: number | null;
  saldoPendiente?: number | null;
  modoPago?: string | null;
  filingStatus?: string | null;
  title?: string | null;
  summary?: string | null;
  recordedAt?: Date | string | null;
  createdAt?: Date | string | null;
  filingJson?: unknown;
}): DashboardCallRow {
  const filing = (call.filingJson || {}) as Record<string, unknown>;
  const evidencia = (filing.evidencia || {}) as Record<string, unknown>;
  const text = (value: unknown) => (value == null ? null : String(value));
  return {
    id: call.id,
    leadName: call.leadName || "",
    offerName: call.offerName || "",
    estadoAgenda: call.estadoAgenda || "",
    ventaTotal: call.ventaTotal ?? null,
    cashCollected: call.cashCollected ?? null,
    saldoPendiente: call.saldoPendiente ?? null,
    modoPago: call.modoPago || "",
    filingStatus: call.filingStatus || "",
    title: call.title || "",
    summary: call.summary || "",
    recordedAt: call.recordedAt || null,
    createdAt: call.createdAt || null,
    producto: text(filing.producto),
    tipo_seguimiento: text(filing.tipo_seguimiento),
    acuerdo_seguimiento: text(filing.acuerdo_seguimiento),
    notas_crm: text(filing.notas_crm),
    proximo_seguimiento: text(filing.proximo_seguimiento),
    cliente_real: text(filing.cliente_real),
    estado_agenda: text(filing.estado_agenda),
    calificado: filing.calificado === true || filing.calificado === false ? filing.calificado : text(filing.calificado),
    lead_id: text(filing.lead_id),
    telefono: text(filing.telefono),
    email: text(filing.email),
    canal_contacto: text(filing.canal_contacto),
    modo_pago: text(filing.modo_pago),
    razon_no_cierre: text(filing.razon_no_cierre),
    requiere_seguimiento:
      filing.requiere_seguimiento === true || filing.requiere_seguimiento === false
        ? filing.requiere_seguimiento
        : text(filing.requiere_seguimiento),
    seguimiento_resultado: text(filing.seguimiento_resultado),
    seguimiento_cerrado: text(filing.seguimiento_cerrado),
    evidencia_cierre: text(evidencia.cierre),
    evidencia_venta: text(evidencia.venta_total),
    evidencia_seguimiento: text(evidencia.seguimiento),
    venta_json: filing.venta_total == null ? null : String(filing.venta_total),
    cash_json: filing.cash_collected == null ? null : String(filing.cash_collected),
    saldo_json: filing.saldo_pendiente == null ? null : String(filing.saldo_pendiente),
    cobros: parseCobros(filing.cobros),
  };
}

function parseCobros(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function selectDashboardCalls(prisma: PrismaClient, userId: string) {
  return prisma.$queryRaw<DashboardCallRow[]>`
    SELECT ${CALL_COLUMNS}
    FROM "CallRecord"
    WHERE "userId" = ${userId}
      AND "filingStatus" <> 'skipped'
    ORDER BY "recordedAt" DESC NULLS LAST, "createdAt" DESC
    LIMIT 2000
  `;
}

/** Newest 2.000 calls that are not skipped. Confirmed rows are the money set. */
export async function loadDashboardCalls(prisma: PrismaClient, userId: string) {
  const rows = await selectDashboardCalls(prisma, userId);
  const mapped = rows.map(dashboardCallFromRow);
  return {
    calls: mapped.filter((row) => row.filingStatus === "confirmed"),
    allCalls: mapped,
  };
}
