import { NextResponse } from "next/server";
import { encryptSecret } from "@/lib/secret-crypto";
import { verifyFathomApiKey, FathomApiError } from "@/lib/fathom";
import { getFathomConnection, requireFathomUser } from "@/lib/fathom-auth";

export async function GET() {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    const connection = await getFathomConnection(prisma, userId);
    if (!connection) {
      return NextResponse.json({ connected: false });
    }

    const total = await prisma.fathomRecording.count({ where: { userId } });
    const withTranscript = await prisma.fathomRecording.count({
      where: { userId, NOT: { transcriptText: "" } },
    });

    return NextResponse.json({
      connected: true,
      lastSyncAt: connection.lastSyncAt?.toISOString() || null,
      total,
      withTranscript,
    });
  } catch (error) {
    console.error("fathom connection GET", error);
    return NextResponse.json(
      { error: "No se pudo leer la conexión de Fathom" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    const body = (await request.json()) as { apiKey?: string };
    const apiKey = body.apiKey?.trim() || "";
    if (apiKey.length < 8) {
      return NextResponse.json(
        { error: "Pega una API key válida de Fathom" },
        { status: 400 },
      );
    }

    try {
      await verifyFathomApiKey(apiKey);
    } catch (error) {
      const message =
        error instanceof FathomApiError && error.status === 401
          ? "API key inválida. Créala en Fathom → Settings → API."
          : "No se pudo validar la API key de Fathom.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const connection = await prisma.fathomConnection.upsert({
      where: { userId },
      create: {
        userId,
        apiKeyEnc: encryptSecret(apiKey),
      },
      update: {
        apiKeyEnc: encryptSecret(apiKey),
      },
    });

    return NextResponse.json({
      connected: true,
      lastSyncAt: connection.lastSyncAt?.toISOString() || null,
    });
  } catch (error) {
    console.error("fathom connection POST", error);
    return NextResponse.json(
      { error: "No se pudo conectar Fathom" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    await prisma.fathomConnection.deleteMany({ where: { userId } });
    return NextResponse.json({ connected: false });
  } catch (error) {
    console.error("fathom connection DELETE", error);
    return NextResponse.json(
      { error: "No se pudo desconectar Fathom" },
      { status: 500 },
    );
  }
}
