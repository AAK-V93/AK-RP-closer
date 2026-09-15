import type { PrismaClient } from "@prisma/client";
import { classifyAndFileCall, maybeCreateAlert } from "@/lib/call-intelligence";
import { findMatchingLead } from "@/lib/lead-match";
import { resolveOpenAlertsForLead } from "@/lib/alerts";
import { ensureCrmTables } from "@/lib/prisma";

export async function fileCallQuietly(
  prisma: PrismaClient,
  userId: string,
  args: {
    source: "fathom" | "upload" | "qc" | "chat";
    sourceId: string;
    title: string;
    transcript: string;
    recordedAt?: Date | null;
  },
) {
  try {
    await ensureCrmTables(prisma);
    const filed = await classifyAndFileCall(prisma, userId, args);
    const { refreshLiveGuides } = await import("@/lib/live-guide");
    void refreshLiveGuides(prisma, userId).catch((error) =>
      console.error("live guide refresh", error),
    );
    return filed;
  } catch (error) {
    console.error("fileCallQuietly", error);
    return null;
  }
}

export type CrmChatPatch = {
  name?: string;
  company?: string;
  offerName?: string;
  status?: string;
  lastSummary?: string;
  nextStep?: string;
  nextStepAt?: string;
  objections?: string;
  amountTalked?: string;
  amountPaid?: string;
  decider?: string;
  alertType?: string;
  confirmCallId?: string;
};

const STATUSES = new Set([
  "nuevo",
  "seguimiento",
  "pendiente",
  "cerrado",
  "perdido",
  "cobro",
  "pagado",
]);

function normalizeStatus(raw?: string) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (value.includes("pagado") || value.includes("completo")) return "pagado";
  if (value.includes("cobro") || value.includes("cuota")) return "cobro";
  if (value.includes("perdi") || value.includes("lost")) return "perdido";
  if (value.includes("cerro") || value.includes("cerrado")) return "cerrado";
  if (value.includes("pendiente") || value.includes("decision")) return "pendiente";
  if (value.includes("seguim") || value.includes("hablo")) return "seguimiento";
  if (STATUSES.has(value)) return value;
  return "";
}

function parseDue(raw?: string) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const iso = text.length <= 10 ? `${text}T12:00:00.000Z` : text;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function applyCrmChatUpdate(
  prisma: PrismaClient,
  userId: string,
  patch: CrmChatPatch | null | undefined,
) {
  const name = String(patch?.name || "").trim();
  if (!name || !patch) return null;
  await ensureCrmTables(prisma);

  const leads = await prisma.lead.findMany({ where: { userId } });
  const existing = findMatchingLead(
    leads,
    name,
    patch.company,
  );
  const status = normalizeStatus(patch.status);
  const nextStepAt = parseDue(patch.nextStepAt);
  const data = {
    company: patch.company?.trim() || existing?.company || "",
    offerName: patch.offerName?.trim() || existing?.offerName || "",
    status: status || existing?.status || "seguimiento",
    lastSummary: patch.lastSummary?.trim() || existing?.lastSummary || "",
    nextStep: patch.nextStep?.trim() || existing?.nextStep || "",
    nextStepAt: nextStepAt || existing?.nextStepAt || null,
    objections: patch.objections?.trim() || existing?.objections || "",
    amountTalked: patch.amountTalked?.trim() || existing?.amountTalked || "",
    amountPaid: patch.amountPaid?.trim() || existing?.amountPaid || "",
    decider: patch.decider?.trim() || existing?.decider || "",
  };

  const lead = existing
    ? await prisma.lead.update({ where: { id: existing.id }, data })
    : await prisma.lead.create({
        data: { userId, name, ...data },
      });

  if (existing) {
    await resolveOpenAlertsForLead(prisma, userId, lead.id);
  }

  await maybeCreateAlert(prisma, userId, lead.id, name, {
    nextStep: data.nextStep,
    nextStepAt: data.nextStepAt,
    status: data.status,
    amountPaid: data.amountPaid,
    alertType: patch.alertType,
  });

  return lead;
}
