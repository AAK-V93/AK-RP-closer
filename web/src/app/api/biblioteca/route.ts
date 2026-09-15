import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { ensureCrmTables } from "@/lib/prisma";
import { parseFollowupScripts } from "@/lib/followup-scripts";
import {
  installPack,
  listPublicPacks,
  publishCustomPack,
  publishPack,
  toggleStar,
} from "@/lib/followup-library";

export async function GET() {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    const [packs, offers] = await Promise.all([
      listPublicPacks(auth.prisma, auth.userId),
      auth.prisma.userOffer.findMany({
        where: { userId: auth.userId },
        select: { id: true, productName: true, commercial: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    return NextResponse.json({
      packs,
      offers: offers.map((row) => ({
        id: row.id,
        productName: row.productName,
        scriptCount: parseFollowupScripts(
          (row.commercial as { scripts?: unknown } | null)?.scripts,
        ).length,
      })),
    });
  } catch (error) {
    console.error("biblioteca GET", error);
    return NextResponse.json({ error: "No se pudo cargar la biblioteca" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    const body = (await request.json()) as {
      action?: "publish" | "publish-offer" | "star" | "install";
      packId?: string;
      offerId?: string;
      title?: string;
      description?: string;
      tags?: string;
      scripts?: unknown;
    };
    if (body.action === "star" && body.packId) {
      const out = await toggleStar(auth.prisma, auth.userId, body.packId);
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 404 });
      }
      return NextResponse.json(out);
    }
    if (body.action === "install" && body.packId && body.offerId) {
      const out = await installPack(auth.prisma, auth.userId, {
        packId: body.packId,
        offerId: body.offerId,
      });
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 404 });
      }
      return NextResponse.json(out);
    }
    if (body.action === "publish-offer" && body.offerId) {
      const out = await publishPack(auth.prisma, auth.userId, {
        offerId: body.offerId,
        title: body.title || "",
        description: body.description,
        tags: body.tags,
      });
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 400 });
      }
      return NextResponse.json(out);
    }
    if (body.action === "publish") {
      const out = await publishCustomPack(auth.prisma, auth.userId, {
        title: body.title || "",
        description: body.description,
        tags: body.tags,
        scripts: body.scripts,
      });
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 400 });
      }
      return NextResponse.json(out);
    }
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (error) {
    console.error("biblioteca POST", error);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}
