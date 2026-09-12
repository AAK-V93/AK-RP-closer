import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getWorkspacePrisma } from "@/lib/workspace";

export async function requireWorkspaceUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Inicia sesión" }, { status: 401 }),
    };
  }
  const prisma = await getWorkspacePrisma();
  if (!prisma) {
    return {
      error: NextResponse.json(
        { error: "La base de datos no está configurada" },
        { status: 503 },
      ),
    };
  }
  return { prisma, userId: session.user.id };
}
