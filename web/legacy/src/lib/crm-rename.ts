import type { Prisma, PrismaClient } from "@prisma/client";
import { findMatchingLead, samePersonName } from "@/lib/lead-match";
import { realClientName } from "@/lib/crm-noise";

const SAVE_ERROR = "No pude guardar el nombre. Inténtalo de nuevo.";

function filingBag(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, unknown>;
  return { ...(value as Record<string, unknown>) };
}

function clienteRealOf(filing: unknown) {
  return String(filingBag(filing).cliente_real || "").trim();
}

/** The name Operación prints for this call, not a different stored field. */
export function displayedCallName(call: {
  leadName?: string | null;
  title?: string | null;
  filingJson?: unknown;
  leadRecord?: string | null;
}) {
  return (
    realClientName(call.leadName) ||
    realClientName(clienteRealOf(call.filingJson)) ||
    realClientName(call.title) ||
    realClientName(call.leadRecord) ||
    ""
  );
}

type NameCall = {
  id: string;
  leadName: string;
  title: string;
  filingJson: unknown;
};

function namesCall(
  row: NameCall,
  fromNames: Set<string>,
  callId: string,
) {
  if (callId && row.id === callId) return true;
  const shown = displayedCallName(row);
  const real = clienteRealOf(row.filingJson);
  const leadName = String(row.leadName || "").trim();
  const title = String(row.title || "").trim();
  return (
    fromNames.has(shown) ||
    fromNames.has(real) ||
    fromNames.has(leadName) ||
    (title && fromNames.has(title) && Boolean(realClientName(title)))
  );
}

/**
 * One update per call. Neon HTTP rejects updateMany.
 * Writes the name Operación shows: leadName, cliente_real, and a title that is that name.
 */
export async function renameCrmCalls(
  prisma: PrismaClient,
  userId: string,
  args: { callId?: string; fromNames: string[]; next: string },
) {
  const next = args.next.trim();
  const callId = String(args.callId || "").trim();
  const fromNames = new Set(
    args.fromNames.map((name) => name.trim()).filter((name) => name && name !== next),
  );
  const rows = (await prisma.callRecord.findMany({
    where: { userId },
    select: { id: true, leadName: true, title: true, filingJson: true },
  })) as NameCall[];
  const targets = rows.filter((row) => namesCall(row, fromNames, callId));
  if (callId && !rows.some((row) => row.id === callId)) {
    throw new Error("No encontré esa fila.");
  }
  let updated = 0;
  for (const row of targets) {
    const filing = filingBag(row.filingJson);
    const shown = displayedCallName(row);
    const title = String(row.title || "").trim();
    filing.cliente_real = next;
    const data: {
      leadName: string;
      filingJson: Prisma.InputJsonValue;
      title?: string;
    } = {
      leadName: next,
      filingJson: filing as Prisma.InputJsonValue,
    };
    if (title && (title === shown || fromNames.has(title)) && realClientName(title)) {
      data.title = next;
    }
    await prisma.callRecord.update({ where: { id: row.id }, data });
    updated += 1;
  }
  return updated;
}

/**
 * Renames the lead the CRM shows.
 * One lead update, then one update per call (Neon HTTP rejects updateMany).
 */
export async function renameShownLead(
  prisma: PrismaClient,
  userId: string,
  args: { callId?: string; leadId?: string; name: string },
): Promise<{ ok: true; name: string } | { error: string }> {
  const next = args.name.trim().replace(/\s+/g, " ");
  if (!next || next.length > 80) return { error: "Ese nombre no es válido." };
  const rawCallId = String(args.callId || "").trim();
  const callId = rawCallId.startsWith("lead:") ? "" : rawCallId;
  let call: {
    id: string;
    leadName: string;
    title: string;
    filingJson: unknown;
  } | null = null;
  try {
    call = callId
      ? await prisma.callRecord.findFirst({ where: { id: callId, userId } })
      : null;
  } catch (error) {
    console.error("rename lead read", error);
    return { error: SAVE_ERROR };
  }
  if (callId && !call) return { error: "No encontré esa fila." };
  let leads: { id: string; name: string; company: string }[] = [];
  try {
    leads = await prisma.lead.findMany({ where: { userId } });
  } catch (error) {
    console.error("rename lead list", error);
    return { error: SAVE_ERROR };
  }
  const shown = displayedCallName({
    leadName: call?.leadName,
    title: call?.title,
    filingJson: call?.filingJson,
  });
  let lead = args.leadId ? leads.find((row) => row.id === args.leadId) || null : null;
  if (!lead && shown) {
    lead =
      findMatchingLead(leads, shown) ||
      leads.find((row) => samePersonName(row.name, shown)) ||
      null;
  }
  if (!lead && !shown && !callId) return { error: "No encontré ese lead." };
  const fromName = shown || lead?.name || "";
  if (!fromName) return { error: "No encontré ese lead." };
  if (next === fromName && (!lead || lead.name === next)) return { ok: true, name: next };
  try {
    if (lead && lead.name !== next) {
      await prisma.lead.update({ where: { id: lead.id }, data: { name: next } });
    }
    const updated = await renameCrmCalls(prisma, userId, {
      callId,
      fromNames: [fromName, shown, clienteRealOf(call?.filingJson), lead?.name || ""].filter(Boolean),
      next,
    });
    if (callId && shown && shown !== next && updated < 1) return { error: SAVE_ERROR };
  } catch (error) {
    console.error("rename lead", error);
    const message = error instanceof Error ? error.message : "";
    if (message === "No encontré esa fila.") return { error: message };
    return { error: SAVE_ERROR };
  }
  return { ok: true, name: next };
}
