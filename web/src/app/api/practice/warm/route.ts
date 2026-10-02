import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureWorkspaceTables, getPrisma } from "@/lib/prisma";
import { loadPracticeContext } from "@/lib/workspace";

/** Wake the database before the closer taps Entrar, without opening a voice room. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const prisma = getPrisma();
  if (!prisma) return NextResponse.json({ ok: false }, { status: 503 });
  try {
    const practice = await loadPracticeContext(prisma, session.user.id);
    return NextResponse.json({ ok: true, ready: Boolean(practice?.offer) });
  } catch {
    try {
      await ensureWorkspaceTables(prisma);
      const practice = await loadPracticeContext(prisma, session.user.id);
      return NextResponse.json({ ok: true, ready: Boolean(practice?.offer) });
    } catch {
      return NextResponse.json({ ok: false }, { status: 503 });
    }
  }
}
