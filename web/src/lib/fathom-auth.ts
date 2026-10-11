import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-crypto";

export async function requireFathomUser() {
  if (!isDatabaseConfigured()) {
    return {
      error: NextResponse.json(
        { error: "La base de datos no está configurada" },
        { status: 503 },
      ),
    };
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Inicia sesión" }, { status: 401 }),
    };
  }

  const prisma = getPrisma();
  if (!prisma) {
    return {
      error: NextResponse.json({ error: "DB no disponible" }, { status: 503 }),
    };
  }

  return { prisma, userId: session.user.id };
}

export async function getFathomConnection(prisma: NonNullable<ReturnType<typeof getPrisma>>, userId: string) {
  return prisma.fathomConnection.findUnique({
    where: { userId },
    select: { apiKeyEnc: true, lastSyncAt: true, backfillStatus: true },
  });
}

export async function getFathomApiKey(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  userId: string,
) {
  const connection = await getFathomConnection(prisma, userId);
  if (!connection) return null;
  try {
    return decryptSecret(connection.apiKeyEnc);
  } catch (error) {
    console.error("fathom decrypt", error);
    return null;
  }
}
