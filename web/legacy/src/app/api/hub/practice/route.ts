import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { practiceCardFromGuides } from "@/lib/home-desk";
import { parseLiveGuide } from "@/lib/live-guide";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

type PracticeCard = ReturnType<typeof practiceCardFromGuides>;

const cache = new Map<string, { at: number; card: PracticeCard }>();
const TTL_MS = 60_000;

/** Guides for the home practice card. Loaded after the first paint, not on /api/hub. */
export async function GET(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
    });
    const userId = typeof token?.sub === "string" ? token.sub : "";
    if (!userId) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.card);
    const prisma = getPrisma();
    if (!prisma) return NextResponse.json({ error: "DB" }, { status: 503 });
    const offers = await prisma.userOffer.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { productName: true, playbook: true },
    });
    const card = practiceCardFromGuides(
      offers.map((row) => parseLiveGuide(row.playbook, row.productName)),
    );
    cache.set(userId, { at: Date.now(), card });
    return NextResponse.json(card);
  } catch (error) {
    console.error("hub practice", error);
    return NextResponse.json(practiceCardFromGuides([]));
  }
}
