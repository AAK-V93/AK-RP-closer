import { AccessToken } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import dotenv from "dotenv";
import path from "path";
import { TokenRequestPayload } from "@/lib/training-helpers";
import { buildProspectInstructions } from "@/lib/prospect-prompt";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });

export async function POST(request: Request) {
  try {
    let payload: TokenRequestPayload;

    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
    if (!geminiApiKey) {
      return Response.json(
        { error: "GEMINI_API_KEY must be set in server environment" },
        { status: 500 },
      );
    }

    const { training, sessionConfig } = payload;
    const instructions = buildProspectInstructions(training);

    const roomName = `closer-${Math.random().toString(36).slice(2, 10)}`;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret || !process.env.LIVEKIT_URL) {
      return Response.json(
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
      gemini_api_key: geminiApiKey,
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

    return Response.json({
      accessToken: await at.toJwt(),
      url: process.env.LIVEKIT_URL,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Error generating token",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
