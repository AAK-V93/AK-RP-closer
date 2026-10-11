import { NextResponse } from "next/server";
import { isPublicHttpsUrl } from "@/lib/app-url";
import { encryptSecret } from "@/lib/secret-crypto";
import { verifyFathomApiKey, FathomApiError } from "@/lib/fathom";
import { getFathomConnection, requireFathomUser } from "@/lib/fathom-auth";
import {
  ensureFathomWebhook,
  fathomWebhookUrl,
  newFathomWebhookToken,
  unregisterFathomWebhook,
} from "@/lib/fathom-ingest";

export async function GET() {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    const connection = await getFathomConnection(prisma, userId);
    if (!connection) {
      return NextResponse.json({ connected: false });
    }

    try {
      await ensureFathomWebhook(prisma, userId);
    } catch (error) {
      console.error("fathom webhook ensure", error);
    }
    const live = (await getFathomConnection(prisma, userId)) || connection;

    const skippedFilter = {
      AND: [
        { practiceSessionId: { not: null } },
        { practiceSessionId: { not: "skipped" } },
      ],
    };
    const total = await prisma.fathomRecording.count({ where: { userId } });
    const withTranscript = await prisma.fathomRecording.count({
      where: {
        userId,
        transcriptText: { not: "" },
        NOT: { transcriptText: "[sin transcripción]" },
      },
    });
    const analyzed = await prisma.fathomRecording.count({
      where: { userId, ...skippedFilter },
    });
    const skipped = await prisma.fathomRecording.count({
      where: { userId, practiceSessionId: "skipped" },
    });

    return NextResponse.json({
      connected: true,
      lastSyncAt: live.lastSyncAt?.toISOString() || null,
      importSince: live.importSince?.toISOString() || null,
      autoIngest: Boolean(live.webhookId),
      total,
      withTranscript,
      analyzed,
      skipped,
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

    const existing = await prisma.fathomConnection.findUnique({ where: { userId } });
    const webhookToken = existing?.webhookToken || newFathomWebhookToken();
    const canRegister = isPublicHttpsUrl(fathomWebhookUrl(webhookToken));

    if (canRegister && existing?.webhookId) {
      try {
        await unregisterFathomWebhook(prisma, userId);
      } catch (error) {
        console.error("fathom reconnect unregister", error);
      }
    }

    const connection = await prisma.fathomConnection.upsert({
      where: { userId },
      create: {
        userId,
        apiKeyEnc: encryptSecret(apiKey),
        webhookToken,
      },
      update: {
        apiKeyEnc: encryptSecret(apiKey),
        webhookToken: existing?.webhookToken || webhookToken,
        ...(canRegister ? { webhookId: "", webhookSecretEnc: "" } : {}),
      },
    });

    let autoIngest = false;
    try {
      const hook = await ensureFathomWebhook(prisma, userId);
      autoIngest = hook.ok;
    } catch (error) {
      console.error("fathom webhook register", error);
    }

    return NextResponse.json({
      connected: true,
      lastSyncAt: connection.lastSyncAt?.toISOString() || null,
      autoIngest,
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

    await unregisterFathomWebhook(prisma, userId);
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
