import { AccessToken } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import dotenv from "dotenv";
import path from "path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { TokenRequestPayload } from "@/lib/training-helpers";
import { buildProspectInstructions } from "@/lib/prospect-prompt";
import { authOptions } from "@/lib/auth";
import { isPresetOffer } from "@/data/offer-cases";
import {
  FREE_USED_CODE,
  assertGuestCanStart,
} from "@/lib/guest-practice";
import { CUSTOM_OFFER_CODE } from "@/lib/guest-practice-client";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      const gate = await assertGuestCanStart(request);
      if (!gate.ok) {
        return NextResponse.json(
          {
            error:
              "Ya usaste tu práctica gratis. Crea una cuenta para seguir.",
            code: FREE_USED_CODE,
          },
          { status: 403 },
        );
      }
    }

    let payload: TokenRequestPayload;

    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const { training, sessionConfig } = payload;

    if (!session?.user?.id) {
      const hasCustomProduct = Boolean(training.productName?.trim());
      if (
        hasCustomProduct &&
        !isPresetOffer(training.productName, training.productDescription)
      ) {
        return NextResponse.json(
          {
            error:
              "Para practicar una oferta propia necesitas una cuenta. Elige una de las tres ofertas listas o crea tu cuenta.",
            code: CUSTOM_OFFER_CODE,
          },
          { status: 403 },
        );
      }
    }

    const instructions = buildProspectInstructions(training);

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
      temperature: sessionConfig.temperature,
      max_output_tokens: sessionConfig.maxOutputTokens,
      nano_banana_enabled: false,
      training_mode: training.callSection,
      product_name: training.productName,
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
