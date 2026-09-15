import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { getWorkspace } from "@/lib/workspace";
import { listReplayCalls, loadReplayCall } from "@/lib/replay-call";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const url = new URL(request.url);
    const source = url.searchParams.get("source");
    const sourceId = url.searchParams.get("id");
    const offerId = url.searchParams.get("offerId");

    if (source && sourceId) {
      if (source !== "fathom" && source !== "upload") {
        return NextResponse.json({ error: "Fuente inválida" }, { status: 400 });
      }
      const replay = await loadReplayCall(
        auth.prisma,
        auth.userId,
        source,
        sourceId,
      );
      if (!replay) {
        return NextResponse.json({ error: "No encontré esa llamada" }, { status: 404 });
      }
      return NextResponse.json({ replay });
    }

    const workspace = await getWorkspace(auth.prisma, auth.userId, offerId);
    if (!workspace.offer) {
      return NextResponse.json({ calls: [] });
    }
    const calls = await listReplayCalls(auth.prisma, auth.userId, {
      id: workspace.offer.id,
      productName: workspace.offer.productName,
      includeFathom: workspace.offer.includeFathom,
    });
    return NextResponse.json({ calls });
  } catch (error) {
    console.error("practice-calls GET", error);
    return NextResponse.json(
      { error: "No se pudieron cargar las llamadas abiertas" },
      { status: 500 },
    );
  }
}
