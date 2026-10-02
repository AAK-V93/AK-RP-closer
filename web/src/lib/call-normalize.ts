import type { Prisma, PrismaClient } from "@prisma/client";
import { TIPOS_SEGUIMIENTO } from "@/lib/crm-catalog";
import { zonedDayKey } from "@/lib/crm-time";
import { spokenFollowupClock } from "@/lib/followup-date";
import { isPriceLabel } from "@/lib/offer-name";
import { explicitAgreement } from "@/lib/stated-deal";

function foldTipo(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Catalog follow-up type, or empty when the extractor stored "Sí" or another non-type. */
export function canonicalTipo(raw: string | null | undefined) {
  const folded = foldTipo(String(raw || ""));
  if (!folded || /^(si|yes|true|ok|null)$/.test(folded)) return "";
  for (const tipo of TIPOS_SEGUIMIENTO) {
    if (foldTipo(tipo) === folded) return tipo;
  }
  return "";
}

export function canonicalProducto(raw: string | null | undefined, offerNames: string[]) {
  const text = String(raw || "").trim();
  const real = offerNames.map((name) => name.trim()).filter((name) => name && !isPriceLabel(name));
  if (!text || isPriceLabel(text)) return real.length === 1 ? real[0] : "";
  const known = real.find((name) => foldTipo(name) === foldTipo(text));
  return known || text;
}

type SaleShape = {
  venta_total: number | null;
  cash_collected: number | null;
  estado_agenda: string | null;
  acuerdo_seguimiento?: string | null;
  notas_crm?: string | null;
  evidencia?: { cierre?: string | null; venta_total?: string | null };
};

/** A mentioned list price on an interrupted call is not a sale. */
export function shouldDropInferredSale(parsed: SaleShape, transcript = "") {
  if (parsed.venta_total == null || parsed.venta_total <= 0) return false;
  const estado = parsed.estado_agenda || "";
  if (estado === "CIERRE VENTA" || estado === "ACUERDO SIN PAGO") return false;
  if (parsed.cash_collected != null && parsed.cash_collected > 0) return false;
  const blob = [
    transcript,
    parsed.acuerdo_seguimiento,
    parsed.notas_crm,
    parsed.evidencia?.cierre,
    parsed.evidencia?.venta_total,
  ]
    .filter(Boolean)
    .join("\n");
  return !explicitAgreement(blob);
}

function clockIsStamp(evidence: string, clock: string) {
  const [hour, minute] = clock.split(":");
  if (!hour || !minute) return false;
  const stamp = new RegExp(`\\b${hour}:${minute}:\\d{2}\\b`);
  const bracket = new RegExp(`\\[${hour}:${minute}`);
  return stamp.test(evidence) || bracket.test(evidence);
}

/**
 * Date in America/Bogota terms. Keeps a clock only when someone said one.
 * 00:xx and a UTC instant's wall clock are not an agreed time.
 */
export function normalizeProximo(value: string | null | undefined, evidence = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const spoken = spokenFollowupClock(evidence);
  if (/Z$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)) {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    const day = zonedDayKey(date);
    return spoken ? `${day} ${spoken}` : day;
  }
  const match = raw.replace("T", " ").match(/^(20\d{2}-\d{2}-\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return "";
  const day = match[1];
  if (!match[2]) return spoken ? `${day} ${spoken}` : day;
  const clock = `${match[2]}:${match[3]}`;
  if (spoken) return `${day} ${spoken}`;
  if (Number(match[2]) === 0 || clockIsStamp(evidence, clock)) return day;
  return `${day} ${clock}`;
}

export type ImportedFiling = {
  producto?: string | null;
  tipo_seguimiento?: string | null;
  proximo_seguimiento?: string | null;
  venta_total?: number | null;
  cash_collected?: number | null;
  saldo_pendiente?: number | null;
  estado_agenda?: string | null;
  acuerdo_seguimiento?: string | null;
  notas_crm?: string | null;
  evidencia?: { cierre?: string | null; venta_total?: string | null; seguimiento?: string | null };
  confianza?: { venta_total?: number; producto?: number; tipo_seguimiento?: number };
};

export function normalizeImportedFiling<T extends ImportedFiling>(parsed: T, transcript = ""): T {
  const tipo = canonicalTipo(parsed.tipo_seguimiento);
  parsed.tipo_seguimiento = tipo || null;
  if (isPriceLabel(parsed.producto)) {
    parsed.producto = null;
    if (parsed.confianza) parsed.confianza.producto = 0;
  }
  const evidence = [
    transcript,
    parsed.acuerdo_seguimiento,
    parsed.notas_crm,
    parsed.evidencia?.seguimiento,
  ]
    .filter(Boolean)
    .join("\n");
  if (parsed.proximo_seguimiento) {
    parsed.proximo_seguimiento = normalizeProximo(parsed.proximo_seguimiento, evidence) || null;
  }
  if (
    shouldDropInferredSale(
      {
        venta_total: parsed.venta_total ?? null,
        cash_collected: parsed.cash_collected ?? null,
        estado_agenda: parsed.estado_agenda ?? null,
        acuerdo_seguimiento: parsed.acuerdo_seguimiento,
        notas_crm: parsed.notas_crm,
        evidencia: parsed.evidencia,
      },
      transcript,
    )
  ) {
    parsed.venta_total = null;
    parsed.saldo_pendiente = null;
    if (parsed.confianza) parsed.confianza.venta_total = 0;
  }
  return parsed;
}

export type CallRepairInput = {
  id: string;
  offerName?: string | null;
  estadoAgenda?: string | null;
  ventaTotal?: number | null;
  saldoPendiente?: number | null;
  cashCollected?: number | null;
  filingJson?: unknown;
};

export type CallRepair = {
  offerName: string;
  ventaTotal: number | null;
  saldoPendiente: number | null;
  filingJson: Record<string, unknown>;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function textOf(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "null") return "";
  return text;
}

/** What to write back for one imported row. Null when the row is already clean. */
export function planCallRepair(call: CallRepairInput, offerNames: string[]): CallRepair | null {
  const filing = asRecord(call.filingJson);
  const estado = textOf(call.estadoAgenda) || textOf(filing.estado_agenda);
  const notes = textOf(filing.notas_crm);
  const acuerdo = textOf(filing.acuerdo_seguimiento);
  const evidenceBag = asRecord(filing.evidencia);
  const evidence = [acuerdo, notes, textOf(evidenceBag.seguimiento), textOf(evidenceBag.cierre)].join("\n");
  let changed = false;

  const tipo = canonicalTipo(textOf(filing.tipo_seguimiento));
  if (textOf(filing.tipo_seguimiento) !== tipo) {
    filing.tipo_seguimiento = tipo || null;
    changed = true;
  }

  const productoRaw = textOf(filing.producto);
  const producto = canonicalProducto(productoRaw, offerNames);
  if (productoRaw !== producto) {
    filing.producto = producto || null;
    changed = true;
  }

  const offerRaw = textOf(call.offerName);
  const offerName = isPriceLabel(offerRaw) ? canonicalProducto(offerRaw, offerNames) : offerRaw;
  if (offerName !== offerRaw) changed = true;

  const proximoRaw = textOf(filing.proximo_seguimiento);
  const proximo = normalizeProximo(proximoRaw, evidence);
  if (proximoRaw.replace("T", " ").slice(0, 16) !== proximo) {
    filing.proximo_seguimiento = proximo || null;
    changed = true;
  }

  const ventaRaw = call.ventaTotal ?? numberOrNull(filing.venta_total);
  const cashRaw = call.cashCollected ?? numberOrNull(filing.cash_collected);
  let ventaTotal = call.ventaTotal ?? null;
  let saldoPendiente = call.saldoPendiente ?? null;
  if (
    shouldDropInferredSale(
      {
        venta_total: ventaRaw,
        cash_collected: cashRaw,
        estado_agenda: estado,
        acuerdo_seguimiento: acuerdo,
        notas_crm: notes,
        evidencia: {
          cierre: textOf(evidenceBag.cierre),
          venta_total: textOf(evidenceBag.venta_total),
        },
      },
      evidence,
    )
  ) {
    if (ventaTotal != null || filing.venta_total != null) {
      ventaTotal = null;
      filing.venta_total = null;
      changed = true;
    }
    if (saldoPendiente != null || filing.saldo_pendiente != null) {
      saldoPendiente = null;
      filing.saldo_pendiente = null;
      changed = true;
    }
  }

  if (!changed) return null;
  return { offerName, ventaTotal, saldoPendiente, filingJson: filing };
}

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function applyCallRepair<T extends CallRepairInput>(call: T, repair: CallRepair): T {
  call.offerName = repair.offerName;
  call.ventaTotal = repair.ventaTotal;
  call.saldoPendiente = repair.saldoPendiente;
  call.filingJson = repair.filingJson;
  return call;
}

/** One single-row update per bad import. Neon HTTP cannot run updateMany. */
export async function repairImportedCallFields(
  prisma: PrismaClient,
  offerNames: string[],
  groups: CallRepairInput[][],
) {
  const seen = new Set<string>();
  const jobs: { id: string; repair: CallRepair }[] = [];
  for (const group of groups) {
    for (const row of group) {
      const repair = planCallRepair(row, offerNames);
      if (!repair) continue;
      applyCallRepair(row, repair);
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      jobs.push({ id: row.id, repair });
    }
  }
  for (const job of jobs.slice(0, 40)) {
    try {
      await prisma.callRecord.update({
        where: { id: job.id },
        data: {
          offerName: job.repair.offerName,
          ventaTotal: job.repair.ventaTotal,
          saldoPendiente: job.repair.saldoPendiente,
          filingJson: job.repair.filingJson as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      console.error("repair imported call", job.id, error);
    }
  }
}
