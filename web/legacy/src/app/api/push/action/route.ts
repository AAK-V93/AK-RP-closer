import { NextResponse } from "next/server";
import { ensureCrmTables, getPrisma, isDatabaseConfigured } from "@/lib/prisma";
import { applyAlertOutcome, type AlertOutcome } from "@/lib/alerts";
import { verifyPushAction } from "@/lib/web-push";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { token?: string; resultado?: string };
    const parsed = verifyPushAction(String(body.token || ""));
    if (!parsed) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }
    const resultado = body.resultado === "no_contesto" ? "no_contesto" : "hecho";
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ error: "DB" }, { status: 503 });
    }
    const prisma = getPrisma();
    if (!prisma) return NextResponse.json({ error: "DB" }, { status: 503 });
    await ensureCrmTables(prisma);
    const out = await applyAlertOutcome(prisma, parsed.userId, parsed.alertId, {
      resultado: resultado as AlertOutcome,
    });
    if ("error" in out) {
      return NextResponse.json({ error: out.error }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("push action", error);
    return NextResponse.json({ error: "No se pudo aplicar" }, { status: 500 });
  }
}
