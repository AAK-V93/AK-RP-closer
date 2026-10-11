// Short-lived access token for the Google Picker in the browser (drive.file only).
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { driveTokenFor } from "@/lib/cases/drive-token";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
  const db = getPrisma();
  const accessToken = db ? await driveTokenFor(db, userId) : null;
  if (!accessToken) return NextResponse.json({ error: "Vuelve a conectar tu Drive." }, { status: 409 });
  return NextResponse.json({ accessToken }, { headers: { "Cache-Control": "no-store" } });
}
