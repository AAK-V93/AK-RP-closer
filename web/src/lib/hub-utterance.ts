import type { PrismaClient } from "@prisma/client";
import { applyAlertOutcome } from "@/lib/alerts";
import { applyExtractorToCrm, loadOffersForCrm } from "@/lib/crm-apply";
import { upsertLeadForAgenda } from "@/lib/agenda";
import { emptyExtractor } from "@/lib/extractor";
import { findMatchingLead } from "@/lib/lead-match";
import { followupQuestion } from "@/lib/followup-scripts";
import { Prisma } from "@prisma/client";

export type HubUtterance =
  | { kind: "wrote"; name: string; payAt: Date }
  | { kind: "closed"; name: string; amount: number }
  | { kind: "no_answer"; name: string }
  | { kind: "agenda"; name: string; when: Date }
  | { kind: "lost"; name: string; reason: string };

const DAYS = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "miércoles",
  "jueves",
  "viernes",
  "sabado",
  "sábado",
];

function fold(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw: string) {
  const compact = raw.replace(/\s/g, "");
  if (/\d{1,3}(?:\.\d{3})+(?:,\d+)?/.test(compact)) {
    const n = Number(compact.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(compact.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function nextWeekday(name: string, from = new Date()) {
  const needle = fold(name);
  const map: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };
  const target = map[needle];
  if (target == null) return null;
  const cursor = new Date(from);
  for (let i = 0; i <= 7; i += 1) {
    const next = new Date(from);
    next.setDate(cursor.getDate() + i);
    if (next.getDay() === target) return next;
  }
  return null;
}

export function parseSpokenDue(raw: string, from = new Date()): Date | null {
  const text = fold(raw);
  if (!text) return null;
  if (/\bmanana\b/.test(text)) {
    const d = new Date(from);
    d.setDate(d.getDate() + 1);
    return applyClock(d, text);
  }
  if (/\bhoy\b/.test(text)) return applyClock(new Date(from), text);
  for (const day of DAYS) {
    if (text.includes(fold(day))) {
      const next = nextWeekday(day, from);
      if (next) return applyClock(next, text);
    }
  }
  const iso = text.match(/(\d{4}-\d{2}-\d{2})(?:[ t](\d{1,2})(?::(\d{2}))?)?/);
  if (iso) {
    const d = new Date(`${iso[1]}T${String(iso[2] || 12).padStart(2, "0")}:${iso[3] || "00"}:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const dmy = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (dmy) {
    const year = dmy[3]
      ? Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3])
      : from.getFullYear();
    const d = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]), 12, 0, 0);
    return Number.isNaN(d.getTime()) ? applyClock(d, text) : applyClock(d, text);
  }
  return applyClock(null, text);
}

function applyClock(base: Date | null, text: string) {
  const clock = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  if (!base) return null;
  const next = new Date(base);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] || 0);
    const mer = (clock[3] || "").replace(/\./g, "");
    if (mer.startsWith("p") && hour < 12) hour += 12;
    if (mer.startsWith("a") && hour === 12) hour = 0;
    next.setHours(hour, minute, 0, 0);
  } else {
    next.setHours(12, 0, 0, 0);
  }
  return next;
}

function firstName(raw: string) {
  return raw.replace(/[.,;:]+$/g, "").trim();
}

export function parseHubUtterance(text: string, now = new Date()): HubUtterance | null {
  const raw = text.trim();
  if (!raw || raw.length > 280) return null;
  const folded = fold(raw);

  const wrote = folded.match(
    /(?:le |les )?(?:escribi|mande|hable|marque|whatsappee|whatsappe)\s+(?:a |con )?([a-zñ]+)\b[\s\S]{0,80}?(?:paga|pagara|pago)\s+(?:el |para el |el dia )?(.+)$/,
  );
  if (wrote) {
    const payAt = parseSpokenDue(wrote[2], now);
    if (payAt) return { kind: "wrote", name: firstName(wrote[1]), payAt };
  }

  const closed = folded.match(
    /(?:cerre|cerramos|cierre)\s+(?:con |a )?([a-zñ]+)\b[\s\S]{0,80}?(?:pago|pago)\s*(?:usd|\$)?\s*(\d[\d.\s,]*)/,
  );
  if (closed) {
    const amount = parseAmount(closed[2]);
    if (amount > 0) return { kind: "closed", name: firstName(closed[1]), amount };
  }

  const noAnswer = folded.match(/no contesto(?: a)?\s+([a-zñ]+)\b/);
  if (noAnswer) return { kind: "no_answer", name: firstName(noAnswer[1]) };

  const agenda = folded.match(
    /agende(?: a)?\s+([a-zñ]+)\s+(?:el |para el |para )?(.+)$/,
  );
  if (agenda) {
    const when = parseSpokenDue(agenda[2], now);
    if (when) return { kind: "agenda", name: firstName(agenda[1]), when };
  }

  const lost = folded.match(/perdi(?: a)?\s+([a-zñ]+)\b(?:,?\s*(.*))?$/);
  if (lost) {
    return {
      kind: "lost",
      name: firstName(lost[1]),
      reason: (lost[2] || "").trim() || "Otro",
    };
  }

  return null;
}

async function leadForName(prisma: PrismaClient, userId: string, name: string) {
  const leads = await prisma.lead.findMany({ where: { userId } });
  return findMatchingLead(leads, name);
}

async function openAlertForLead(prisma: PrismaClient, userId: string, leadId: string) {
  return prisma.leadAlert.findFirst({
    where: { userId, leadId, resolvedAt: null },
    orderBy: { dueAt: "asc" },
  });
}

export async function applyHubUtterance(
  prisma: PrismaClient,
  userId: string,
  spoken: HubUtterance,
) {
  if (spoken.kind === "agenda") {
    await prisma.callRecord.create({
      data: {
        userId,
        source: "chat",
        sourceId: `agenda-${Date.now()}`,
        title: `Agendado: ${spoken.name}`,
        leadName: spoken.name,
        estadoAgenda: "AGENDADO",
        callType: "AGENDADO",
        recordedAt: spoken.when,
        filingStatus: "confirmed",
        confirmedAt: new Date(),
        summary: `AGENDADO · ${spoken.name}`,
      },
    });
    await upsertLeadForAgenda(prisma, userId, spoken.name, "");
    return {
      reply: `Agendé a ${spoken.name} el ${spoken.when.toISOString().slice(0, 16).replace("T", " ")}.`,
    };
  }

  const lead = await leadForName(prisma, userId, spoken.name);
  if (!lead) {
    return {
      reply: `No tengo a ${spoken.name} en el CRM. ¿Cómo se llama en tus llamadas?`,
      gap: true as const,
    };
  }

  if (spoken.kind === "wrote") {
    const open = await openAlertForLead(prisma, userId, lead.id);
    if (open) {
      await applyAlertOutcome(prisma, userId, open.id, { resultado: "hecho" });
    }
    const enJuego = open?.enJuego || 0;
    await prisma.leadAlert.create({
      data: {
        userId,
        leadId: lead.id,
        type: "PAGO PENDIENTE",
        question: followupQuestion("PAGO PENDIENTE", lead.name, enJuego),
        dueAt: spoken.payAt,
        enJuego,
        canal: "WHATSAPP",
        contexto: "El closer escribió y el lead paga en esa fecha.",
      },
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: "cobro",
        nextStep: "PAGO PENDIENTE",
        nextStepAt: spoken.payAt,
      },
    });
    return {
      reply: `Anoté que le escribiste a ${lead.name}. Pago pendiente el ${spoken.payAt.toISOString().slice(0, 10)}.`,
    };
  }

  if (spoken.kind === "no_answer") {
    const open = await openAlertForLead(prisma, userId, lead.id);
    if (!open) {
      return { reply: `No hay un seguimiento abierto de ${lead.name}.`, gap: true as const };
    }
    const out = await applyAlertOutcome(prisma, userId, open.id, {
      resultado: "no_contesto",
    });
    if ("askLost" in out && out.askLost) {
      return { reply: `Tercer intento con ${lead.name}. ¿Lo marco perdido?` };
    }
    return { reply: `No contestó ${lead.name}. Sumé un intento.` };
  }

  if (spoken.kind === "lost") {
    const open = await openAlertForLead(prisma, userId, lead.id);
    if (open) {
      await applyAlertOutcome(prisma, userId, open.id, {
        resultado: "perdido",
        razonNoCierre: spoken.reason,
        nota: spoken.reason,
      });
    } else {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: "perdido", razonNoCierre: spoken.reason },
      });
    }
    return { reply: `Marqué a ${lead.name} como perdido (${spoken.reason}).` };
  }

  const offers = await loadOffersForCrm(prisma, userId);
  const offer = offers.find((row) => row.productName === lead.offerName) || offers[0];
  const parsed = emptyExtractor();
  parsed.cliente_real = lead.name;
  parsed.estado_agenda = "CIERRE VENTA";
  parsed.producto = lead.offerName || offer?.productName || "";
  parsed.cash_collected = spoken.amount;
  parsed.venta_total = spoken.amount;
  parsed.saldo_pendiente = 0;
  parsed.requiere_revision_humana = false;
  parsed.notas_crm = `Cierre por chat: pagó ${spoken.amount}`;
  parsed.confianza = {
    cliente_real: 100,
    estado_agenda: 100,
    producto: 100,
    venta_total: 100,
    cash_collected: 100,
    modo_pago: 100,
    requiere_seguimiento: 100,
    tipo_seguimiento: 100,
    proximo_seguimiento: 100,
    acuerdo_seguimiento: 100,
  };

  const call = await prisma.callRecord.create({
    data: {
      userId,
      source: "chat",
      sourceId: `cierre-${Date.now()}`,
      title: `Cierre: ${lead.name}`,
      leadName: lead.name,
      offerName: parsed.producto || "",
      estadoAgenda: "CIERRE VENTA",
      callType: "CIERRE VENTA",
      result: "cerro",
      recordedAt: new Date(),
      filingStatus: "confirmed",
      confirmedAt: new Date(),
      ventaTotal: spoken.amount,
      cashCollected: spoken.amount,
      saldoPendiente: 0,
      filingJson: parsed as unknown as Prisma.InputJsonValue,
      summary: `${lead.name} · ${parsed.producto} · CIERRE VENTA`,
    },
  });
  await applyExtractorToCrm(prisma, userId, call.id, parsed, offers);
  return {
    reply: `Cierre con ${lead.name}: pagó USD ${spoken.amount}. Dejé la comisión y la cadena de cobro.`,
  };
}
