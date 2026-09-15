import type { PrismaClient } from "@prisma/client";
import { parseCrmPrefs } from "@/lib/crm-prefs";
import { enqueueStaleAgendaChecks, expireAcuerdoSinPago } from "@/lib/agenda";
import { appUrl } from "@/lib/app-url";
import { syncAllCalendars } from "@/lib/calendar";
import { emailConfigured, sendEmail } from "@/lib/email";
import { pollRecentFathomCalls } from "@/lib/fathom-ingest";
import { whatsappClickHref } from "@/lib/whatsapp-link";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function enqueueUnpaidCommissionAlerts(prisma: PrismaClient) {
  const rows = await prisma.commission.findMany({
    where: { estado: { not: "COBRADA" } },
    include: { lead: true, user: { select: { crmPrefs: true } } },
    take: 200,
  });
  let created = 0;
  for (const row of rows) {
    const prefs = parseCrmPrefs(row.user.crmPrefs);
    if (Date.now() - row.fecha.getTime() < prefs.commissionUnpaidDays * 86400000) continue;
    if (!row.leadId) continue;
    const open = await prisma.leadAlert.findFirst({
      where: {
        userId: row.userId,
        leadId: row.leadId,
        type: "COMISION",
        resolvedAt: null,
      },
    });
    if (open) continue;
    const due = Math.round(row.generada - row.cobrada);
    await prisma.leadAlert.create({
      data: {
        userId: row.userId,
        leadId: row.leadId,
        type: "COMISION",
        question: `¿Ya te pagaron la comisión de ${row.lead?.name || row.oferta} (USD ${due})?`,
        dueAt: new Date(),
        enJuego: Math.max(0, due),
        canal: "WHATSAPP",
      },
    });
    created += 1;
  }
  return created;
}

export async function runCrmHourlyJobs(prisma: PrismaClient) {
  const fathom = await pollRecentFathomCalls(prisma).catch((error) => {
    console.error("fathom poll", error);
    return { users: 0, ingested: 0, filed: 0, webhooks: 0 };
  });
  const calendar = await syncAllCalendars(prisma).catch((error) => {
    console.error("calendar sync", error);
    return { users: 0, events: 0 };
  });
  const agendas = await enqueueStaleAgendaChecks(prisma);
  const acuerdos = await expireAcuerdoSinPago(prisma);
  const commissions = await enqueueUnpaidCommissionAlerts(prisma);

  const alerts = await prisma.leadAlert.findMany({
    where: { resolvedAt: null, dueAt: { lte: new Date() } },
    include: {
      user: { select: { id: true, email: true, name: true } },
      lead: { select: { name: true, telefono: true } },
    },
    take: 400,
  });

  const byUser = new Map<
    string,
    {
      email: string | null;
      name: string | null;
      items: { question: string; wa: string; copy: string }[];
    }
  >();
  for (const alert of alerts) {
    const current = byUser.get(alert.userId) || {
      email: alert.user.email,
      name: alert.user.name,
      items: [],
    };
    const copy = alert.mensajeSugerido || alert.question;
    current.items.push({
      question: alert.question,
      copy,
      wa: whatsappClickHref(alert.lead.telefono, copy),
    });
    byUser.set(alert.userId, current);
  }

  const origin = appUrl();
  const hub = `${origin}/`;
  let emailed = 0;
  for (const user of byUser.values()) {
    const count = user.items.length;
    const slice = user.items.slice(0, 8);
    const text = `Hola${user.name ? ` ${user.name}` : ""}.

Hoy: ${count} pendiente${count === 1 ? "" : "s"}.

${slice
  .map(
    (item, i) =>
      `${i + 1}. ${item.question}
   WhatsApp: ${item.wa}`,
  )
  .join("\n\n")}

Para actualizar el CRM (hecho / no contestó / cerró / perdido) abre:
${hub}
`;
    if (emailConfigured() && user.email) {
      const subject =
        count === 1
          ? "Hoy: 1 pendiente en Closer Trainer"
          : `Hoy: ${count} pendientes en Closer Trainer`;
      await sendEmail({
        to: user.email,
        subject,
        text,
        html: `<p>Hola${user.name ? ` ${escapeHtml(user.name)}` : ""}.</p>
<p>Hoy tienes <strong>${count}</strong> pendiente${count === 1 ? "" : "s"}. El link de WhatsApp abre el chat con el lead y el texto listo. Después marcas el CRM en la app.</p>
<ol>${slice
          .map(
            (item) => `<li>
  <p>${escapeHtml(item.question)}</p>
  <p><a href="${escapeHtml(item.wa)}">Abrir WhatsApp</a>
  · <a href="${hub}">Marcar en el CRM</a></p>
</li>`,
          )
          .join("")}</ol>
<p><a href="${hub}">Abrir Closer Trainer</a></p>`,
      });
      emailed += 1;
    }
  }

  return {
    fathom,
    calendar,
    agendas,
    acuerdos,
    commissions,
    emailed,
    due: alerts.length,
  };
}
