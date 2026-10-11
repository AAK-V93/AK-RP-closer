// Starts the Drive consent (scope drive.file only). Separate from Calendar.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { appUrl } from "@/lib/app-url";
import { authOptions } from "@/lib/auth";
import { driveAuthUrl, driveConfigured, signDriveState } from "@/lib/cases/drive";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const offerId = new URL(request.url).searchParams.get("offer") ?? "";
  const back = new URL(`/ofertas?oferta=${encodeURIComponent(offerId)}&tab=casos`, appUrl());
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(back.pathname + back.search)}`, appUrl()));
  if (!driveConfigured()) {
    back.searchParams.set("error", "La conexión con Drive todavía no está activada.");
    return NextResponse.redirect(back);
  }
  const state = signDriveState({ userId, offerId });
  return NextResponse.redirect(driveAuthUrl(`${appUrl()}/api/drive/callback`, state));
}
