import { NextResponse } from "next/server";
import { getPrisma, ensureCrmTables } from "@/lib/prisma";
import { parseCalendarState, saveCalendarRefresh, syncUserCalendar } from "@/lib/calendar";

function origin() {
  return (
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const userId = parseCalendarState(state);
  const dest = `${origin()}/llamadas`;
  if (!code || !userId) {
    return NextResponse.redirect(`${dest}?calendar=error`);
  }
  const prisma = getPrisma();
  if (!prisma) return NextResponse.redirect(`${dest}?calendar=error`);
  try {
    await ensureCrmTables(prisma);
    await saveCalendarRefresh(prisma, userId, code);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { calendarRefreshEnc: true },
    });
    if (user?.calendarRefreshEnc) {
      await syncUserCalendar(prisma, userId, user.calendarRefreshEnc).catch((error) =>
        console.error("calendar first sync", error),
      );
    }
    return NextResponse.redirect(`${dest}?calendar=ok`);
  } catch (error) {
    console.error("calendar callback", error);
    return NextResponse.redirect(`${dest}?calendar=error`);
  }
}
