import { NextResponse } from "next/server";
import { getPrisma, ensureCrmTables } from "@/lib/prisma";
import { parseCalendarState, saveCalendarRefresh, syncUserCalendar } from "@/lib/calendar";
import { appUrl } from "@/lib/app-url";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const parsed = parseCalendarState(state);
  const dest = `${parsed?.origin || appUrl()}/llamadas`;
  if (!code || !parsed?.userId) {
    return NextResponse.redirect(`${dest}?calendar=error`);
  }
  const prisma = getPrisma();
  if (!prisma) return NextResponse.redirect(`${dest}?calendar=error`);
  try {
    await ensureCrmTables(prisma);
    await saveCalendarRefresh(prisma, parsed.userId, code, parsed.origin);
    const user = await prisma.user.findUnique({
      where: { id: parsed.userId },
      select: { calendarRefreshEnc: true },
    });
    if (user?.calendarRefreshEnc) {
      await syncUserCalendar(prisma, parsed.userId, user.calendarRefreshEnc).catch((error) =>
        console.error("calendar first sync", error),
      );
    }
    return NextResponse.redirect(`${dest}?calendar=ok`);
  } catch (error) {
    console.error("calendar callback", error);
    return NextResponse.redirect(`${dest}?calendar=error`);
  }
}
