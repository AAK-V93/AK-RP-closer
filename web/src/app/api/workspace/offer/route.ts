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
      id?: string;
      productName?: string;
      productDescription?: string;
      pitchSummary?: string;
      includeFathom?: boolean;
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

    const existingCount = await auth.prisma.userOffer.count({
      where: { userId: auth.userId },
    });

    const includeFathom =
      typeof body.includeFathom === "boolean"
        ? body.includeFathom
        : existingCount === 0;

    let offer;
    if (body.id) {
      const owned = await auth.prisma.userOffer.findFirst({
        where: { id: body.id, userId: auth.userId },
      });
      if (!owned) {
        return NextResponse.json({ error: "Oferta no encontrada" }, { status: 404 });
      }
      offer = await auth.prisma.userOffer.update({
        where: { id: owned.id },
        data: {
          productName,
          productDescription,
          pitchSummary,
          includeFathom,
        },
      });
    } else {
      offer = await auth.prisma.userOffer.create({
        data: {
          userId: auth.userId,
          productName,
          productDescription,
          pitchSummary,
          includeFathom,
        },
      });
    }

    const workspace = await getWorkspace(auth.prisma, auth.userId, offer.id);
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

    const next = await getWorkspace(auth.prisma, auth.userId, offer.id);
    return NextResponse.json({
      offer: next.offer,
      offers: next.offers,
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

export async function DELETE(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json()) as { id?: string };
    if (!body.id) {
      return NextResponse.json({ error: "Falta el id" }, { status: 400 });
    }
    await auth.prisma.userOffer.deleteMany({
      where: { id: body.id, userId: auth.userId },
    });
    const next = await getWorkspace(auth.prisma, auth.userId);
    return NextResponse.json({
      ok: true,
      offer: next.offer,
      offers: next.offers,
      ready: next.ready,
    });
  } catch (error) {
    console.error("workspace offer delete", error);
    return NextResponse.json(
      { error: "No se pudo borrar la oferta" },
      { status: 500 },
    );
  }
}
