import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { THREAD_HUB, loadThread } from "@/lib/chat-threads";
import { visibleHubThread } from "@/lib/hub-crm-chat";
import { labelCrmProse } from "@/lib/plain-labels";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** The hub chat history. Inicio does not wait on this. */
export async function GET(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
    });
    const userId = typeof token?.sub === "string" ? token.sub : "";
    if (!userId) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
    const prisma = getPrisma();
    if (!prisma) return NextResponse.json({ error: "DB" }, { status: 503 });
    const loaded = await loadThread(prisma, userId, THREAD_HUB);
    const messages = visibleHubThread(
      (loaded?.messages || []).map((line) =>
        line.role === "coach" ? { ...line, content: labelCrmProse(line.content) } : line,
      ),
    );
    return NextResponse.json(
      { messages },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("hub thread", error);
    return NextResponse.json({ messages: [] });
  }
}
