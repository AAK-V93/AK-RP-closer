import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { ensureCrmTables } from "@/lib/prisma";
import {
  disconnectCalendar,
  googleCalendarConfigured,
  syncUserCalendar,
  calendarRedirectUri,
} from "@/lib/calendar";
import { requestOrigin } from "@/lib/app-url";

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    const user = await auth.prisma.user.findUnique({
      where: { id: auth.userId },
      select: { calendarRefreshEnc: true, calendarSyncedAt: true },
    });
    return NextResponse.json({
      configured: googleCalendarConfigured(),
      connected: Boolean(user?.calendarRefreshEnc),
      syncedAt: user?.calendarSyncedAt?.toISOString() || null,
      redirectUri: calendarRedirectUri(requestOrigin(request)),
    });
  } catch (error) {
    console.error("calendar GET", error);
    return NextResponse.json({ error: "No se pudo leer Calendar" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    const user = await auth.prisma.user.findUnique({
      where: { id: auth.userId },
      select: { calendarRefreshEnc: true },
    });
    if (!user?.calendarRefreshEnc) {
      return NextResponse.json({ error: "Conecta Google Calendar" }, { status: 400 });
    }
    const events = await syncUserCalendar(auth.prisma, auth.userId, user.calendarRefreshEnc);
    return NextResponse.json({ ok: true, events });
  } catch (error) {
    console.error("calendar POST", error);
    return NextResponse.json({ error: "No se pudo sincronizar" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await disconnectCalendar(auth.prisma, auth.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("calendar DELETE", error);
    return NextResponse.json({ error: "No se pudo desconectar" }, { status: 500 });
  }
}
