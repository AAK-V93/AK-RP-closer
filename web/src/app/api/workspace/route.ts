import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";
import { requireWorkspaceUser } from "@/lib/workspace-auth";

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const offerId = new URL(request.url).searchParams.get("offerId");
    const workspace = await getWorkspace(auth.prisma, auth.userId, offerId);
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
      canPractice: workspace.canPractice,
    });
  } catch (error) {
    console.error("workspace GET", error);
    return NextResponse.json(
      { error: "No se pudo leer tu espacio de entrenamiento" },
      { status: 500 },
    );
  }
}
