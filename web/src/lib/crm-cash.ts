import type { Prisma, PrismaClient } from "@prisma/client";
import { filingNamesFullyMatch, matchLeadForFiling } from "@/lib/lead-match";
import { dealMoney } from "@/lib/deal-money";
import { cobrosAfterCashChange } from "@/lib/crm-rollup";

export function parseCashInput(value: unknown): { ok: true; amount: number } | { ok: false } {
  if (value == null || value === "") return { ok: true, amount: 0 };
  const text = String(value).trim().replace(/\s/g, "");
  if (!text) return { ok: true, amount: 0 };
  const normalized = /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text.replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return { ok: false };
  return { ok: true, amount: Math.round(amount) };
}

/**
 * The lead a call's cash belongs to: the lead stamped on the call when the names
 * really match, else one full-name match. A shared first name is never enough
 * («Carlos y Luciana Quito» is not «Carlos Ramírez»).
 */
export function leadForCashCall<T extends { id: string; name: string; aliases?: readonly string[] | null }>(
  leads: readonly T[],
  call: { leadName?: string | null; filingJson?: unknown },
): T | null {
  const name = String(call.leadName || "").trim();
  const filing =
    call.filingJson && typeof call.filingJson === "object" && !Array.isArray(call.filingJson)
      ? (call.filingJson as Record<string, unknown>)
      : {};
  const stampedId = typeof filing.lead_id === "string" ? filing.lead_id : "";
  const stamped = stampedId ? leads.find((lead) => lead.id === stampedId) : undefined;
  if (stamped && (!name || filingNamesFullyMatch(stamped.name, name, stamped.aliases))) return stamped;
  if (!name) return null;
  const match = matchLeadForFiling(leads, name);
  return match.kind === "one" ? match.lead : null;
}

/** Sets cash cobrado on one call and the matching lead. 0 clears it. */
export async function setRecordedCash(
  prisma: PrismaClient,
  userId: string,
  callId: string,
  value: unknown,
): Promise<{ ok: true } | { error: string }> {
  const parsed = parseCashInput(value);
  if (!parsed.ok) return { error: "Ese monto no es válido." };
  const call = await prisma.callRecord.findFirst({
    where: { id: callId, userId },
  });
  if (!call) return { error: "No encontré esa llamada." };
  const amount = parsed.amount;
  const filing =
    call.filingJson && typeof call.filingJson === "object" && !Array.isArray(call.filingJson)
      ? { ...(call.filingJson as Record<string, unknown>) }
      : {};
  filing.cash_collected = amount > 0 ? amount : 0;
  // Keep «falta» in step with the new cash (total = pagado + falta).
  const venta = Number(call.ventaTotal) || 0;
  const saldo = venta > 0 ? dealMoney({ venta, cash: amount }).falta : null;
  if (saldo != null) filing.saldo_pendiente = saldo;
  const previous = Math.round(Number(call.cashCollected) || 0);
  filing.cobros = cobrosAfterCashChange({
    filingJson: call.filingJson,
    previous,
    next: amount,
    saleAt: call.recordedAt || call.createdAt,
  });
  await prisma.callRecord.update({
    where: { id: call.id },
    data: {
      cashCollected: amount > 0 ? amount : 0,
      ...(saldo != null ? { saldoPendiente: saldo } : {}),
      filingJson: filing as Prisma.InputJsonValue,
    },
  });
  if (call.leadName || call.filingJson) {
    const leads = await prisma.lead.findMany({ where: { userId } });
    const lead = leadForCashCall(leads, call);
    if (lead) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { amountPaid: amount > 0 ? String(amount) : "0" },
      });
    }
  }
  return { ok: true };
}
