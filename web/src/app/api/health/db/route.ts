import { NextResponse } from "next/server";
import {
  describeDatabaseUrl,
  getPrisma,
  prismaErrorCode,
} from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const info = describeDatabaseUrl();
  if (!info.hasDatabaseUrl) {
    return NextResponse.json({
      ok: false,
      ...info,
      error: "DATABASE_URL is missing in this deployment",
    });
  }

  try {
    const prisma = getPrisma();
    if (!prisma) {
      return NextResponse.json({
        ok: false,
        ...info,
        error: "Could not parse DATABASE_URL into a postgres URL",
      });
    }
    const users = await prisma.user.count();
    return NextResponse.json({
      ok: true,
      ...info,
      users,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      ...info,
      code: prismaErrorCode(error),
      error: error instanceof Error ? error.message.slice(0, 240) : "unknown",
    });
  }
}
