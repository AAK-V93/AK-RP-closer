import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { ensureCrmTables } from "@/lib/prisma";
import { vapidPublicKey } from "@/lib/web-push";

export async function GET() {
  const key = vapidPublicKey();
  if (!key) {
    return NextResponse.json({ error: "Push no configurado" }, { status: 503 });
  }
  return NextResponse.json({ publicKey: key });
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    const body = (await request.json()) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
      prompted?: boolean;
    };
    const markPrompted = async () => {
      const user = await auth.prisma.user.findUnique({
        where: { id: auth.userId },
        select: { crmPrefs: true },
      });
      const prefs = {
        ...((user?.crmPrefs || {}) as Record<string, unknown>),
        pushPromptedAt: new Date().toISOString(),
      };
      await auth.prisma.user.update({
        where: { id: auth.userId },
        data: { crmPrefs: prefs as Prisma.InputJsonValue },
      });
    };
    if (body.prompted && !body.endpoint) {
      await markPrompted();
      return NextResponse.json({ ok: true });
    }
    const endpoint = String(body.endpoint || "").trim();
    const p256dh = String(body.keys?.p256dh || "").trim();
    const authKey = String(body.keys?.auth || "").trim();
    if (!endpoint || !p256dh || !authKey) {
      return NextResponse.json({ error: "Suscripción inválida" }, { status: 400 });
    }
    const userAgent = request.headers.get("user-agent") || "";
    await auth.prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: auth.userId,
        endpoint,
        p256dh,
        auth: authKey,
        userAgent: userAgent.slice(0, 240),
      },
      update: {
        userId: auth.userId,
        p256dh,
        auth: authKey,
        userAgent: userAgent.slice(0, 240),
      },
    });
    await markPrompted();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("push subscribe", error);
    return NextResponse.json({ error: "No se pudo suscribir" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json()) as { endpoint?: string };
    const endpoint = String(body.endpoint || "").trim();
    if (endpoint) {
      await auth.prisma.pushSubscription.deleteMany({
        where: { userId: auth.userId, endpoint },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("push unsubscribe", error);
    return NextResponse.json({ error: "No se pudo borrar" }, { status: 500 });
  }
}
