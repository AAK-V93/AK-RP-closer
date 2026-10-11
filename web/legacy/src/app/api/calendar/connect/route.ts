import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { calendarOAuthUrl, googleCalendarConfigured } from "@/lib/calendar";
import { requestOrigin } from "@/lib/app-url";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login?callbackUrl=/llamadas", requestOrigin(request)));
  }
  if (!googleCalendarConfigured()) {
    return NextResponse.json({ error: "Falta GOOGLE_CLIENT_ID" }, { status: 400 });
  }
  return NextResponse.redirect(calendarOAuthUrl(session.user.id, requestOrigin(request)));
}
