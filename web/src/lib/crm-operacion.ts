import { normalizeProximo } from "@/lib/call-normalize";
import { labelCrmProse } from "@/lib/plain-labels";
import { followupIsClosed } from "@/lib/crm-followups";
import { isInternalNoise, visibleCallTitle } from "@/lib/crm-noise";
import { zonedDayKey } from "@/lib/crm-time";

export type OperacionRow = {
  id: string;
  leadId?: string;
  leadStatus?: string;
  interna?: boolean;
  titulo?: string;
  fecha: string | null;
  cliente: string;
  telefono: string;
  email: string;
  canal: string;
  estadoAgenda: string;
  fechaProximo: string;
  producto: string;
  oferta: string;
  venta: number | null;
  modoPago: string;
  cash: number | null;
  saldo: number | null;
  notas: string;
  requiereSeguimiento: string;
  tipoSeguimiento: string;
  acuerdo: string;
  razonNoCierre: string;
  filingStatus: string;
  seguimientoResultado: string;
  seguimientoHecho: string;
  seguimientoCerrado: boolean;
};

type FilingBag = Record<string, unknown>;

function asStr(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "null") return "";
  return text;
}

function asNum(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asSiNo(value: unknown) {
  if (value === true || String(value).toLowerCase() === "si" || String(value).toLowerCase() === "sí") {
    return "SI";
  }
  if (value === false || String(value).toLowerCase() === "no") return "NO";
  return "";
}

function isoDay(value: Date | string | null | undefined) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return asStr(value).slice(0, 10) || null;
  return zonedDayKey(date) || null;
}

export type OperacionCall = {
  id: string;
  recordedAt?: Date | string | null;
  createdAt?: Date | string;
  leadName?: string | null;
  title?: string | null;
  offerName?: string | null;
  estadoAgenda?: string | null;
  ventaTotal?: number | null;
  cashCollected?: number | null;
  saldoPendiente?: number | null;
  modoPago?: string | null;
  summary?: string | null;
  filingStatus?: string | null;
  filingJson?: unknown;
};

export type OperacionLead = {
  name?: string;
  telefono?: string | null;
  email?: string | null;
  canalContacto?: string | null;
  razonNoCierre?: string | null;
};

/** "Otro o null" and a bare null are the same bucket as Otro. */
export function cleanReason(raw: string | null | undefined) {
  const original = String(raw || "").trim();
  const text = original
    .replace(/\s+o\s+null\b/gi, "")
    .replace(/\bnull\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^otro$/i.test(text)) {
    return /otro|null/i.test(original) ? "Otro" : "";
  }
  return text;
}

export function operacionFromCall(
  call: OperacionCall,
  lead?: OperacionLead | null,
): OperacionRow {
  const filing = (call.filingJson || {}) as FilingBag;
  const requiere = asSiNo(
    filing.requiere_seguimiento ?? filing.requiereSeguimiento,
  );
  const evidence = filing.evidencia && typeof filing.evidencia === "object"
    ? asStr((filing.evidencia as FilingBag).seguimiento)
    : "";
  const proximo = normalizeProximo(
    asStr(filing.proximo_seguimiento),
    [asStr(filing.acuerdo_seguimiento), asStr(filing.notas_crm), evidence].join("\n"),
  );
  const seguimientoResultado = asStr(filing.seguimiento_resultado).toLowerCase();
  const cerrado = followupIsClosed({
    seguimiento_resultado: seguimientoResultado,
    proximo_seguimiento: proximo,
  });
  const fecha = isoDay(call.recordedAt) || isoDay(call.createdAt);
  const cliente = asStr(call.leadName) || asStr(filing.cliente_real) || lead?.name || "";
  const estadoAgenda = asStr(call.estadoAgenda).toUpperCase() || asStr(filing.estado_agenda).toUpperCase();
  const titulo = visibleCallTitle({
    title: call.title || "",
    leadName: cliente,
    date: call.recordedAt || call.createdAt || fecha,
    summary: asStr(call.summary) || asStr(filing.notas_crm),
  });
  return {
    id: call.id,
    fecha,
    titulo,
    interna: isInternalNoise({
      cliente,
      estadoAgenda,
      title: call.title,
    }),
    cliente,
    telefono: asStr(filing.telefono) || asStr(lead?.telefono),
    email: asStr(filing.email) || asStr(lead?.email),
    canal:
      asStr(filing.canal_contacto).toUpperCase() ||
      asStr(lead?.canalContacto).toUpperCase(),
    estadoAgenda,
    fechaProximo: proximo,
    producto: asStr(filing.producto) || asStr(call.offerName),
    oferta: asStr(call.offerName),
    venta: call.ventaTotal ?? asNum(filing.venta_total),
    modoPago: asStr(call.modoPago) || asStr(filing.modo_pago),
    cash: call.cashCollected ?? asNum(filing.cash_collected),
    saldo: call.saldoPendiente ?? asNum(filing.saldo_pendiente),
    notas: labelCrmProse(asStr(filing.notas_crm) || asStr(call.summary)),
    requiereSeguimiento: requiere,
    tipoSeguimiento: asStr(filing.tipo_seguimiento).toUpperCase(),
    acuerdo: asStr(filing.acuerdo_seguimiento),
    razonNoCierre: cleanReason(asStr(filing.razon_no_cierre) || asStr(lead?.razonNoCierre)),
    filingStatus: asStr(call.filingStatus) || "confirmed",
    seguimientoResultado,
    seguimientoHecho: asStr(filing.seguimiento_cerrado),
    seguimientoCerrado: cerrado && !/^\d{4}-\d{2}-\d{2}/.test(proximo.slice(0, 10)),
  };
}

export function moneyLabel(value: number | null | undefined, currency = "USD") {
  if (value == null || Number.isNaN(value)) return "—";
  const digits = String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${currency} ${digits}`;
}

export function pctLabel(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}
