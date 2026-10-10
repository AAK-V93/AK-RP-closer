import { NextResponse } from "next/server";
import { getPrisma, ensureCrmTables, isDatabaseConfigured } from "@/lib/prisma";
import { notifyDueAlerts, pushConfigured } from "@/lib/web-push";
import { pushQuietHours } from "@/lib/db-quiet";

export const runtime = "nodejs";
export const maxDuration = 60;

function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // Night or no push keys: answer without waking the database (Neon Free sleeps when idle).
  if (pushQuietHours(new Date())) {
    return NextResponse.json({ ok: true, skipped: "quiet-hours" });
  }
  if (!pushConfigured()) {
    return NextResponse.json({ ok: true, skipped: "push-off" });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DB" }, { status: 503 });
  }
  const prisma = getPrisma();
  if (!prisma) return NextResponse.json({ error: "DB" }, { status: 503 });
  await ensureCrmTables(prisma);
  const push = await notifyDueAlerts(prisma);
  return NextResponse.json({ ok: true, push });
}
