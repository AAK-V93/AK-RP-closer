import type { PrismaClient } from "@prisma/client";
import { findMatchingLead } from "@/lib/lead-match";
import { addDays, parseCrmPrefs } from "@/lib/crm-prefs";

const DONE = new Set([
  "SHOW",
  "CIERRE VENTA",
  "ACUERDO SIN PAGO",
  "NO SHOW",
  "REPROGRAMA",
]);

function namesClose(a: string, b: string) {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Si entra un transcript, el AGENDADO de esa persona/hora deja de contar como futuro. */
export async function fulfillAgendado(
  prisma: PrismaClient,
  userId: string,
  args: { leadName: string; recordedAt: Date | null; estado: string | null },
) {
  const name = args.leadName.trim();
  const estado = args.estado || "";
  if (!name || !DONE.has(estado)) return;
  const at = args.recordedAt?.getTime() || Date.now();
  const windowMs = 18 * 3600 * 1000;
  const open = await prisma.callRecord.findMany({
    where: { userId, estadoAgenda: "AGENDADO" },
    take: 40,
  });
  for (const row of open) {
    if (!namesClose(row.leadName, name)) continue;
    const when = row.recordedAt?.getTime() || 0;
    if (when && Math.abs(when - at) > windowMs) continue;
    await prisma.callRecord.update({
      where: { id: row.id },
      data: { estadoAgenda: estado, result: "cumplido" },
    });
    await prisma.leadAlert.updateMany({
      where: {
        userId,
        callRecordId: row.id,
        type: "AGENDA_CHECK",
        resolvedAt: null,
      },
      data: { resolvedAt: new Date(), resultado: "hecho" },
    });
  }
}

export async function upsertLeadForAgenda(
  prisma: PrismaClient,
  userId: string,
  name: string,
  offerName = "",
) {
  const leads = await prisma.lead.findMany({ where: { userId } });
  const existing = findMatchingLead(leads, name);
  if (existing) {
    return prisma.lead.update({
      where: { id: existing.id },
      data: {
        status: "seguimiento",
        offerName: offerName || existing.offerName,
      },
    });
  }
  return prisma.lead.create({
    data: {
      userId,
      name,
      offerName,
      status: "seguimiento",
      nextStep: "Llamada agendada",
    },
  });
}

/** A las 24 h de un AGENDADO sin transcript → pregunta SHOW / NO SHOW / REPROGRAMA. */
export async function enqueueStaleAgendaChecks(prisma: PrismaClient) {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await prisma.callRecord.findMany({
    where: {
      estadoAgenda: "AGENDADO",
      recordedAt: { lte: cutoff, gte: new Date(Date.now() - 14 * 86400000) },
    },
    take: 200,
  });
  let created = 0;
  for (const row of rows) {
    const name = row.leadName.trim();
    if (!name) continue;
    const later = await prisma.callRecord.findFirst({
      where: {
        userId: row.userId,
        leadName: { equals: name, mode: "insensitive" },
        estadoAgenda: { in: [...DONE] },
        recordedAt: { gte: row.recordedAt || undefined },
        NOT: { id: row.id },
      },
    });
    if (later) {
      await prisma.callRecord.update({
        where: { id: row.id },
        data: { estadoAgenda: later.estadoAgenda, result: "cumplido" },
      });
      continue;
    }
    const lead = await upsertLeadForAgenda(prisma, row.userId, name, row.offerName);
    const open = await prisma.leadAlert.findFirst({
      where: {
        userId: row.userId,
        leadId: lead.id,
        type: "AGENDA_CHECK",
        resolvedAt: null,
      },
    });
    if (open) continue;
    await prisma.leadAlert.create({
      data: {
        userId: row.userId,
        leadId: lead.id,
        type: "AGENDA_CHECK",
        question: `¿Se hizo la llamada con ${name}?`,
        dueAt: new Date(),
        canal: "WHATSAPP",
        contexto: row.title,
        callRecordId: row.id,
      },
    });
    created += 1;
  }
  return created;
}

/** ACUERDO SIN PAGO sin cobro a N días → DECISION (cierre caído). */
export async function expireAcuerdoSinPago(prisma: PrismaClient) {
  const rows = await prisma.callRecord.findMany({
    where: { estadoAgenda: "ACUERDO SIN PAGO" },
    take: 200,
  });
  let moved = 0;
  for (const row of rows) {
    const prefs = parseCrmPrefs(
      (await prisma.user.findUnique({
        where: { id: row.userId },
        select: { crmPrefs: true },
      }))?.crmPrefs,
    );
    const at = row.recordedAt || row.createdAt;
    if (Date.now() - at.getTime() < prefs.acuerdoSinPagoDays * 86400000) continue;
    const paid = await prisma.commission.findFirst({
      where: { userId: row.userId, callRecordId: row.id },
    });
    if (paid) continue;
    await prisma.callRecord.update({
      where: { id: row.id },
      data: { estadoAgenda: "SHOW", result: "caido" },
    });
    if (row.leadName) {
      const lead = await upsertLeadForAgenda(
        prisma,
        row.userId,
        row.leadName,
        row.offerName,
      );
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: "seguimiento", etapaPerdida: "Cierre" },
      });
      const open = await prisma.leadAlert.findFirst({
        where: {
          userId: row.userId,
          leadId: lead.id,
          type: "DECISION",
          resolvedAt: null,
        },
      });
      if (!open) {
        await prisma.leadAlert.create({
          data: {
            userId: row.userId,
            leadId: lead.id,
            type: "DECISION",
            question: `El acuerdo con ${row.leadName} no se cobró. ¿Lo retomas o lo marcas perdido?`,
            dueAt: new Date(),
            enJuego: row.ventaTotal || 0,
            canal: "WHATSAPP",
            callRecordId: row.id,
          },
        });
      }
    }
    moved += 1;
  }
  return moved;
}

export async function applyAgendaCheck(
  prisma: PrismaClient,
  userId: string,
  alertId: string,
  estado: "SHOW" | "NO SHOW" | "REPROGRAMA",
) {
  const alert = await prisma.leadAlert.findFirst({
    where: { id: alertId, userId, resolvedAt: null },
    include: { lead: true },
  });
  if (!alert) return { error: "Alerta no encontrada" as const };

  await prisma.leadAlert.update({
    where: { id: alert.id },
    data: { resolvedAt: new Date(), resultado: estado.toLowerCase() },
  });

  const record = alert.callRecordId
    ? await prisma.callRecord.findFirst({
        where: { id: alert.callRecordId, userId },
      })
    : await prisma.callRecord.findFirst({
        where: { userId, leadName: alert.lead.name, estadoAgenda: "AGENDADO" },
        orderBy: { recordedAt: "desc" },
      });

  if (record) {
    await prisma.callRecord.update({
      where: { id: record.id },
      data: {
        estadoAgenda: estado,
        callType: estado,
        result: estado === "SHOW" ? "sin_grabacion" : estado.toLowerCase(),
      },
    });
  }

  const now = new Date();
  if (estado === "NO SHOW") {
    await prisma.leadAlert.create({
      data: {
        userId,
        leadId: alert.leadId,
        type: "REAGENDAR",
        question: `¿Ya reagendaste con ${alert.lead.name}?`,
        dueAt: addDays(now, 1),
        canal: "WHATSAPP",
        callRecordId: record?.id || "",
      },
    });
  } else if (estado === "REPROGRAMA") {
    const when = addDays(now, 1);
    await prisma.callRecord.create({
      data: {
        userId,
        source: "chat",
        sourceId: `agenda-${Date.now()}`,
        title: `Reprogramado: ${alert.lead.name}`,
        leadName: alert.lead.name,
        offerName: alert.lead.offerName,
        estadoAgenda: "AGENDADO",
        callType: "AGENDADO",
        recordedAt: when,
        filingStatus: "confirmed",
        confirmedAt: now,
        summary: `AGENDADO · ${alert.lead.name}`,
      },
    });
    await prisma.leadAlert.create({
      data: {
        userId,
        leadId: alert.leadId,
        type: "SEGUNDA REUNION",
        question: `Llamada reprogramada con ${alert.lead.name}. ¿Se hizo?`,
        dueAt: when,
        canal: "WHATSAPP",
      },
    });
  } else {
    await prisma.leadAlert.create({
      data: {
        userId,
        leadId: alert.leadId,
        type: "DECISION",
        question: `Hoy: seguimiento con ${alert.lead.name} (show sin grabación). ¿Lo hiciste?`,
        dueAt: addDays(now, 1),
        canal: "WHATSAPP",
        callRecordId: record?.id || "",
      },
    });
  }

  return { ok: true as const, estado };
}
