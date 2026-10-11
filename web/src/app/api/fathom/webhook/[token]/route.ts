// Fathom «new meeting content ready» webhook (plan 2.6). Answers fast; the
// brief runs after the response (next/server after). Idempotent: a resend
// changes nothing. No polling and no cron anywhere: Fathom calls us.
import { after, NextResponse } from "next/server";
import { handleFathomWebhook, WEBHOOK_MAX_BYTES } from "@/lib/ingest/webhook";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getPrisma();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > WEBHOOK_MAX_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
  const raw = await request.text();
  if (raw.length > WEBHOOK_MAX_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
  const reply = await handleFathomWebhook(db, token, request.headers, raw);
  if (reply.later) {
    const later = reply.later;
    after(async () => {
      try {
        await later();
      } catch (error) {
        console.warn("[fathom] brief after webhook failed:", error instanceof Error ? error.message.slice(0, 160) : "unknown");
      }
    });
  }
  return NextResponse.json(reply.body, { status: reply.status });
}
