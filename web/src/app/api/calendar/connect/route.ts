import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { calendarOAuthUrl, googleCalendarConfigured } from "@/lib/calendar";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login?callbackUrl=/llamadas", process.env.NEXTAUTH_URL || "http://localhost:3000"));
  }
  if (!googleCalendarConfigured()) {
    return NextResponse.json({ error: "Falta GOOGLE_CLIENT_ID" }, { status: 400 });
  }
  return NextResponse.redirect(calendarOAuthUrl(session.user.id));
}
