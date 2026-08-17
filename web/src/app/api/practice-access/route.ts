import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGuestAccess, getGuestQcAccess } from "@/lib/guest-practice";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    return NextResponse.json({
      allowed: true,
      remaining: null,
      used: false,
      qcAllowed: true,
      qcUsed: false,
      authenticated: true,
    });
  }

  const [access, qc] = await Promise.all([
    getGuestAccess(request),
    getGuestQcAccess(request),
  ]);
  return NextResponse.json({
    ...access,
    qcAllowed: qc.allowed,
    qcUsed: qc.used,
    authenticated: false,
  });
}
