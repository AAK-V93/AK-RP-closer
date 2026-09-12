import { AccessToken } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import dotenv from "dotenv";
import path from "path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { TokenRequestPayload } from "@/lib/training-helpers";
import { buildProspectInstructions } from "@/lib/prospect-prompt";
import { authOptions } from "@/lib/auth";
import { getWorkspace, getWorkspacePrisma } from "@/lib/workspace";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });

const SETUP_REQUIRED_CODE = "SETUP_REQUIRED";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error:
            "Crea una cuenta y sube tu oferta y tus llamadas para practicar.",
          code: SETUP_REQUIRED_CODE,
        },
        { status: 403 },
      );
    }

    let payload: TokenRequestPayload;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const { training, sessionConfig } = payload;
    const prisma = await getWorkspacePrisma();
    if (!prisma) {
      return NextResponse.json({ error: "DB no disponible" }, { status: 503 });
    }

    let requestedOfferId = training.offerId || null;
    if (!requestedOfferId && training.productName.trim()) {
      const match = await prisma.userOffer.findFirst({
        where: { userId: session.user.id, productName: training.productName },
        orderBy: { updatedAt: "desc" },
      });
      requestedOfferId = match?.id || null;
    }

    const workspace = await getWorkspace(prisma, session.user.id, requestedOfferId);
    if (!workspace.offer) {
      return NextResponse.json(
        {
          error: "Primero guarda tu oferta en Configuración.",
          code: SETUP_REQUIRED_CODE,
        },
        { status: 403 },
      );
    }
    if (!workspace.ready) {
      return NextResponse.json(
        {
          error:
            "Sube transcripciones o conecta Fathom para que el prospecto emule a tus leads.",
          code: SETUP_REQUIRED_CODE,
        },
        { status: 403 },
      );
    }

    const trainingWithOffer = {
      ...training,
      productName: workspace.offer.productName,
      productDescription: workspace.offer.productDescription,
      pitchSummary: training.pitchSummary || workspace.offer.pitchSummary,
      leadPlaybook: workspace.playbook,
    };

    const instructions = buildProspectInstructions(
      trainingWithOffer,
      "closer",
      workspace.playbook,
    );

    const roomName = `closer-${Math.random().toString(36).slice(2, 10)}`;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret || !process.env.LIVEKIT_URL) {
      return NextResponse.json(
        { error: "LiveKit credentials must be set in environment" },
        { status: 500 },
      );
    }

    const metadata = {
      instructions,
      model: sessionConfig.model,
      modalities: sessionConfig.modalities,
      voice: sessionConfig.voice,
      temperature: 0.9,
      max_output_tokens: sessionConfig.maxOutputTokens,
      nano_banana_enabled: false,
      training_mode: training.callSection,
      product_name: workspace.offer.productName,
      difficulty: training.difficulty,
      language: training.language,
    };

    const at = new AccessToken(apiKey, apiSecret, {
      identity: "closer",
      metadata: JSON.stringify(metadata),
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      canUpdateOwnMetadata: true,
    });

    at.roomConfig = new RoomConfiguration({
      name: roomName,
      agents: [
        new RoomAgentDispatch({
          agentName: "closer-trainer",
        }),
      ],
    });

    return NextResponse.json({
      accessToken: await at.toJwt(),
      url: process.env.LIVEKIT_URL,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Error generating token",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
