import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getPrisma, prismaErrorCode } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual check only: nothing calls this on a schedule (plan 2.6, never-do 8).
// Needs header x-health-secret = HEALTH_CHECK_SECRET; without the env var it is off.
function authorized(request: Request) {
  const secret = process.env.HEALTH_CHECK_SECRET?.trim();
  const given = request.headers.get("x-health-secret")?.trim();
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  const prisma = getPrisma();
  if (!prisma) return NextResponse.json({ ok: false, code: "NO_DATABASE_URL" });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, code: prismaErrorCode(error) });
  }
}
