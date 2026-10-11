import { NextResponse } from "next/server";
import { getPrisma, ensureCrmTables, isDatabaseConfigured } from "@/lib/prisma";
import { notifyDueAlerts } from "@/lib/web-push";

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
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DB" }, { status: 503 });
  }
  const prisma = getPrisma();
  if (!prisma) return NextResponse.json({ error: "DB" }, { status: 503 });
  await ensureCrmTables(prisma);
  const push = await notifyDueAlerts(prisma);
  return NextResponse.json({ ok: true, push });
}
