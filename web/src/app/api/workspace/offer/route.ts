import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { extractLeadPlaybook } from "@/lib/lead-playbook";
import { getWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;

    const body = (await request.json()) as {
      productName?: string;
      productDescription?: string;
      pitchSummary?: string;
    };
    const productName = body.productName?.trim() || "";
    const productDescription = body.productDescription?.trim() || "";
    const pitchSummary = body.pitchSummary?.trim() || "";
    if (productName.length < 2 || productDescription.length < 20) {
      return NextResponse.json(
        { error: "Nombre y descripción de la oferta son obligatorios" },
        { status: 400 },
      );
    }

    const offer = await auth.prisma.userOffer.upsert({
      where: { userId: auth.userId },
      create: {
        userId: auth.userId,
        productName,
        productDescription,
        pitchSummary,
      },
      update: {
        productName,
        productDescription,
        pitchSummary,
      },
    });

    const workspace = await getWorkspace(auth.prisma, auth.userId);
    if (workspace.corpus.length > 0) {
      try {
        const playbook = await extractLeadPlaybook({
          productName,
          productDescription,
          transcripts: workspace.corpus,
        });
        await auth.prisma.userOffer.update({
          where: { id: offer.id },
          data: { playbook: playbook as unknown as Prisma.InputJsonValue },
        });
      } catch (error) {
        console.error("playbook after offer", error);
      }
    }

    const next = await getWorkspace(auth.prisma, auth.userId);
    return NextResponse.json({
      offer: next.offer,
      ready: next.ready,
      playbookReady: next.playbookReady,
      transcriptCount: next.transcriptCount,
    });
  } catch (error) {
    console.error("workspace offer", error);
    return NextResponse.json(
      { error: "No se pudo guardar la oferta" },
      { status: 500 },
    );
  }
}
