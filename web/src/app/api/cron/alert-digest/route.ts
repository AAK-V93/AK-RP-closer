import { NextResponse } from "next/server";
import { getPrisma, ensureCrmTables, isDatabaseConfigured } from "@/lib/prisma";
import { runCrmHourlyJobs } from "@/lib/crm-jobs";
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
  const pushOnlyEarly = new URL(request.url).searchParams.get("pushOnly") === "1";
  if (pushOnlyEarly && (pushQuietHours(new Date()) || !pushConfigured())) {
    return NextResponse.json({ ok: true, skipped: "push-quiet" });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DB" }, { status: 503 });
  }
  const prisma = getPrisma();
  if (!prisma) return NextResponse.json({ error: "DB" }, { status: 503 });
  await ensureCrmTables(prisma);
  const url = new URL(request.url);
  const pushOnly = url.searchParams.get("pushOnly") === "1";
  const push = await notifyDueAlerts(prisma).catch((error) => {
    console.error("push due", error);
    return { due: 0, pushed: 0 };
  });
  if (pushOnly) {
    return NextResponse.json({ ok: true, push });
  }
  const result = await runCrmHourlyJobs(prisma);
  return NextResponse.json({ ok: true, push, ...result });
}
