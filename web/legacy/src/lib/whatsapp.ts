import type { PrismaClient } from "@prisma/client";
import { applyAlertOutcome, type AlertOutcome } from "@/lib/alerts";
import { applyAgendaCheck } from "@/lib/agenda";
import { parseCrmPrefs } from "@/lib/crm-prefs";

export function twilioWhatsAppConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_WHATSAPP_FROM?.trim(),
  );
}

export function normalizeWhatsApp(raw: string) {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return "";
  return digits.startsWith("+") ? digits : `+${digits.replace(/^00/, "")}`;
}

export async function sendWhatsApp(to: string, body: string) {
  if (!twilioWhatsAppConfigured()) return false;
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const from = process.env.TWILIO_WHATSAPP_FROM!;
  const dest = normalizeWhatsApp(to);
  if (!dest) return false;
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
        To: dest.startsWith("whatsapp:") ? dest : `whatsapp:${dest}`,
        Body: body.slice(0, 1500),
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("twilio whatsapp", res.status, text);
    return false;
  }
  return true;
}

export function parseWhatsAppReply(text: string): {
  resultado?: AlertOutcome;
  agenda?: "SHOW" | "NO SHOW" | "REPROGRAMA";
  amount?: number;
  razon?: string;
} {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const amountMatch = raw.match(/(\d[\d.,]{1,})/);
  const amount = amountMatch ? Number(amountMatch[1].replace(/[^\d]/g, "")) : undefined;
  if (/no show|noshow/i.test(lower)) return { agenda: "NO SHOW" };
  if (/reprog/i.test(lower)) return { agenda: "REPROGRAMA" };
  if (/\bshow\b/i.test(lower) && /sin grab|sin transcrip|se hizo/i.test(lower)) {
    return { agenda: "SHOW" };
  }
  if (/^show$/i.test(lower) || /se hizo|sin grabaci/i.test(lower)) return { agenda: "SHOW" };
  if (/no contest/i.test(lower)) return { resultado: "no_contesto" };
  if (/reprog/i.test(lower)) return { resultado: "reprogramado" };
  if (/perdid/i.test(lower)) return { resultado: "perdido", razon: raw };
  if (/cerr[oó]|pag[oó]/i.test(lower)) return { resultado: "cerro", amount };
  if (/hecho|listo|hecho|sí lo hice|si lo hice|enviado/i.test(lower)) {
    return { resultado: "hecho" };
  }
  return {};
}

export async function findUserByWhatsApp(prisma: PrismaClient, from: string) {
  const needle = normalizeWhatsApp(from.replace(/^whatsapp:/, ""));
  if (!needle) return null;
  const users = await prisma.user.findMany({
    select: { id: true, crmPrefs: true },
    take: 400,
  });
  return (
    users.find((row) => {
      const prefs = parseCrmPrefs(row.crmPrefs);
      return normalizeWhatsApp(prefs.whatsappE164) === needle;
    }) || null
  );
}

export async function applyWhatsAppInbound(
  prisma: PrismaClient,
  userId: string,
  text: string,
) {
  const parsed = parseWhatsAppReply(text);
  const due = await prisma.leadAlert.findFirst({
    where: { userId, resolvedAt: null, dueAt: { lte: new Date() } },
    orderBy: { dueAt: "asc" },
  });
  if (!due) return { reply: "No tengo pendientes abiertos. Escribe en el hub si agendaste a alguien." };
  if (due.type === "AGENDA_CHECK" && parsed.agenda) {
    await applyAgendaCheck(prisma, userId, due.id, parsed.agenda);
    return { reply: `Anoté ${parsed.agenda} con esa llamada.` };
  }
  if (parsed.resultado) {
    const out = await applyAlertOutcome(prisma, userId, due.id, {
      resultado: parsed.resultado,
      amount: parsed.amount,
      razonNoCierre: parsed.razon,
      nota: text,
    });
    if ("askLost" in out && out.askLost) {
      return { reply: "Tercer intento. ¿Lo marco perdido?" };
    }
    return { reply: "Anotado." };
  }
  return {
    reply: `Pendiente: ${due.question}\nResponde: hecho / no contestó / reprogramar / cerró 3000 / perdido.`,
  };
}
