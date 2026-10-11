// Google sends the person back here after the Drive consent.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { appUrl } from "@/lib/app-url";
import { authOptions } from "@/lib/auth";
import { DRIVE_SCOPE, exchangeDriveCode, readDriveState } from "@/lib/cases/drive";
import { getPrisma } from "@/lib/prisma";
import { saveDriveConnection } from "@/lib/write/drive";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.redirect(new URL("/login?callbackUrl=/ofertas", appUrl()));
  const state = readDriveState(params.get("state") ?? "", userId);
  const back = new URL(`/ofertas?oferta=${encodeURIComponent(state?.offerId ?? "")}&tab=casos`, appUrl());
  const fail = (msg: string) => {
    back.searchParams.set("error", msg);
    return NextResponse.redirect(back);
  };
  if (!state) return fail("El permiso de Drive venció. Inténtalo de nuevo.");
  const code = params.get("code");
  if (!code) return fail("No diste permiso para leer tu Drive.");
  const token = await exchangeDriveCode(code, `${appUrl()}/api/drive/callback`);
  if (!token?.refresh_token) return fail("Google no me dio permiso para leer tu Drive. Inténtalo de nuevo.");
  const db = getPrisma();
  if (!db) return fail("No pude guardar la conexión.");
  await saveDriveConnection(db, userId, { refreshToken: token.refresh_token, scope: token.scope ?? DRIVE_SCOPE });
  back.searchParams.set("ok", "Tu Drive quedó conectado. Ya puedes elegir la hoja.");
  return NextResponse.redirect(back);
}
