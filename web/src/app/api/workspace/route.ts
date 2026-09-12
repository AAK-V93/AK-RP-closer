import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";
import { requireWorkspaceUser } from "@/lib/workspace-auth";

export async function GET() {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const workspace = await getWorkspace(auth.prisma, auth.userId);
    return NextResponse.json({
      offer: workspace.offer,
      playbook: workspace.playbook,
      playbookReady: workspace.playbookReady,
      transcripts: workspace.transcripts,
      uploadCount: workspace.uploadCount,
      fathomCount: workspace.fathomCount,
      transcriptCount: workspace.transcriptCount,
      ready: workspace.ready,
    });
  } catch (error) {
    console.error("workspace GET", error);
    return NextResponse.json(
      { error: "No se pudo leer tu espacio de entrenamiento" },
      { status: 500 },
    );
  }
}
