import { NextResponse } from "next/server";
import { getPrisma, ensureCrmTables, isDatabaseConfigured } from "@/lib/prisma";
import {
  applyWhatsAppInbound,
  findUserByWhatsApp,
  sendWhatsApp,
  twilioWhatsAppConfigured,
} from "@/lib/whatsapp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!twilioWhatsAppConfigured()) {
    return NextResponse.json({ error: "Twilio no configurado" }, { status: 503 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DB" }, { status: 503 });
  }
  const prisma = getPrisma();
  if (!prisma) return NextResponse.json({ error: "DB" }, { status: 503 });
  await ensureCrmTables(prisma);

  const form = await request.formData();
  const account = String(form.get("AccountSid") || "");
  if (account && account !== process.env.TWILIO_ACCOUNT_SID) {
    return NextResponse.json({ error: "Sid" }, { status: 401 });
  }
  const from = String(form.get("From") || "").replace(/^whatsapp:/, "");
  const body = String(form.get("Body") || "").trim();
  const user = await findUserByWhatsApp(prisma, from);
  let reply = "No tengo ese número. En el hub dime: mi WhatsApp es +51…";
  if (user && body) {
    const out = await applyWhatsAppInbound(prisma, user.id, body);
    reply = out.reply;
  }
  await sendWhatsApp(from, reply).catch(() => undefined);
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { "Content-Type": "text/xml" } },
  );
}
