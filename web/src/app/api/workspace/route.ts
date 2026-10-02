import { NextResponse } from "next/server";
import { getHomeState } from "@/lib/home-state";
import { getWorkspace } from "@/lib/workspace";
import { requireWorkspaceUser } from "@/lib/workspace-auth";

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const url = new URL(request.url);
    if (url.searchParams.get("view") === "nav") {
      const home = await getHomeState(auth.prisma, auth.userId);
      return NextResponse.json({ showCrm: home.showCrm });
    }
    const offerId = url.searchParams.get("offerId");
    const [workspace, home] = await Promise.all([
      getWorkspace(auth.prisma, auth.userId, offerId, { corpus: false }),
      getHomeState(auth.prisma, auth.userId),
    ]);
    return NextResponse.json({
      offers: workspace.offers,
      offer: workspace.offer,
      playbook: workspace.playbook,
      playbookReady: workspace.playbookReady,
      transcripts: workspace.transcripts,
      uploadCount: workspace.uploadCount,
      fathomCount: workspace.fathomCount,
      transcriptCount: workspace.transcriptCount,
      ready: workspace.ready,
      hasAnyOffer: workspace.hasAnyOffer,
      canPractice: home.canPractice,
      homePhase: home.phase,
      showCrm: home.showCrm,
    });
  } catch (error) {
    console.error("workspace GET", error);
    return NextResponse.json(
      { error: "No se pudo leer tu espacio de entrenamiento" },
      { status: 500 },
    );
  }
}
