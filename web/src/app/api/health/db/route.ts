import { NextResponse } from "next/server";
import { getDatabaseUrl, getPrisma, prismaErrorCode } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = getDatabaseUrl();
  if (!url) {
    return NextResponse.json({
      ok: false,
      hasDatabaseUrl: false,
      error: "DATABASE_URL is missing in this deployment",
    });
  }

  let host = "unknown";
  try {
    host = new URL(url).host;
  } catch {
    host = "unparseable";
  }

  try {
    const prisma = getPrisma();
    if (!prisma) {
      return NextResponse.json({
        ok: false,
        hasDatabaseUrl: true,
        host,
        error: "Prisma client was not created",
      });
    }
    const users = await prisma.user.count();
    return NextResponse.json({
      ok: true,
      hasDatabaseUrl: true,
      host,
      users,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      hasDatabaseUrl: true,
      host,
      code: prismaErrorCode(error),
      error: error instanceof Error ? error.message.slice(0, 240) : "unknown",
    });
  }
}
