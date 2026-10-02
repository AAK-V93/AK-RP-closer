import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureWorkspaceTables, getPrisma } from "@/lib/prisma";
import { warmPracticeWorker } from "@/lib/practice-dispatch";
import { loadPracticeContext } from "@/lib/workspace";

/** Wake the database and the voice worker before the closer taps Entrar. */
async function wakePracticeWorker(userId: string) {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return;
  try {
    await warmPracticeWorker({ url, apiKey, apiSecret, userId });
  } catch (error) {
    console.error("practice warm", error);
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const prisma = getPrisma();
  if (!prisma) return NextResponse.json({ ok: false }, { status: 503 });
  try {
    const practice = await loadPracticeContext(prisma, session.user.id);
    await wakePracticeWorker(session.user.id);
    return NextResponse.json({ ok: true, ready: Boolean(practice?.offer) });
  } catch {
    try {
      await ensureWorkspaceTables(prisma);
      const practice = await loadPracticeContext(prisma, session.user.id);
      await wakePracticeWorker(session.user.id);
      return NextResponse.json({ ok: true, ready: Boolean(practice?.offer) });
    } catch {
      return NextResponse.json({ ok: false }, { status: 503 });
    }
  }
}
