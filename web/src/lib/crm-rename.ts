import type { PrismaClient } from "@prisma/client";
import { findMatchingLead } from "@/lib/lead-match";
import { sameDisplayedPerson } from "@/lib/hub-crm-chat";

/**
 * Renames the lead the CRM shows.
 * One lead update, plus one SQL statement for the calls (Neon HTTP rejects updateMany).
 */
export async function renameShownLead(
  prisma: PrismaClient,
  userId: string,
  args: { callId?: string; leadId?: string; name: string },
): Promise<{ ok: true; name: string } | { error: string }> {
  const next = args.name.trim().replace(/\s+/g, " ");
  if (!next || next.length > 80) return { error: "Ese nombre no es válido." };
  const callId = String(args.callId || "").trim();
  const call = callId
    ? await prisma.callRecord.findFirst({ where: { id: callId, userId } })
    : null;
  if (callId && !call) return { error: "No encontré esa fila." };
  const leads = await prisma.lead.findMany({ where: { userId } });
  const shown = String(call?.leadName || "").trim();
  let lead = args.leadId ? leads.find((row) => row.id === args.leadId) || null : null;
  if (!lead && shown) {
    lead =
      findMatchingLead(leads, shown) ||
      leads.find((row) => sameDisplayedPerson(row.name, shown)) ||
      null;
  }
  if (!lead && !shown && !callId) return { error: "No encontré ese lead." };
  const fromName = shown || lead?.name || "";
  if (next === fromName && (!lead || lead.name === next)) return { ok: true, name: next };
  if (lead && lead.name !== next) {
    await prisma.lead.update({ where: { id: lead.id }, data: { name: next } });
  }
  const previous = lead?.name || fromName;
  await prisma.$executeRaw`
    UPDATE "CallRecord"
    SET "leadName" = ${next}
    WHERE "userId" = ${userId}
      AND (
        "id" = ${callId}
        OR "leadName" = ${fromName}
        OR "leadName" = ${previous}
      )
  `;
  return { ok: true, name: next };
}
