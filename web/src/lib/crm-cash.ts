import type { Prisma, PrismaClient } from "@prisma/client";
import { findMatchingLead } from "@/lib/lead-match";

export function parseCashInput(value: unknown): { ok: true; amount: number } | { ok: false } {
  if (value == null || value === "") return { ok: true, amount: 0 };
  const text = String(value).trim().replace(/\s/g, "");
  if (!text) return { ok: true, amount: 0 };
  const normalized = /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text.replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return { ok: false };
  return { ok: true, amount: Math.round(amount) };
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
  await prisma.callRecord.update({
    where: { id: call.id },
    data: {
      cashCollected: amount > 0 ? amount : 0,
      filingJson: filing as Prisma.InputJsonValue,
    },
  });
  if (call.leadName) {
    const leads = await prisma.lead.findMany({ where: { userId } });
    const lead = findMatchingLead(leads, call.leadName);
    if (lead) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { amountPaid: amount > 0 ? String(amount) : "0" },
      });
    }
  }
  return { ok: true };
}
