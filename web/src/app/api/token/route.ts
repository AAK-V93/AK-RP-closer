import { AccessToken } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import dotenv from "dotenv";
import path from "path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { TokenRequestPayload } from "@/lib/training-helpers";
import {
  buildProspectInstructions,
  generateProspectProfile,
  maxTokensForProspect,
} from "@/lib/prospect-prompt";
import { authOptions } from "@/lib/auth";
import { loadPracticeContext } from "@/lib/workspace";
import { loadReplayCall } from "@/lib/replay-call";
import { ensureWorkspaceTables, getPrisma } from "@/lib/prisma";
import { dispatchPracticeAgent } from "@/lib/practice-dispatch";
import { liveGuideForPrompt } from "@/lib/live-guide";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });

const SETUP_REQUIRED_CODE = "SETUP_REQUIRED";

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const [session, payload] = await Promise.all([
      getServerSession(authOptions),
      request.json().catch(() => null) as Promise<TokenRequestPayload | null>,
    ]);
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

    if (!payload?.training || !payload.sessionConfig) {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const prisma = getPrisma();
    if (!prisma) {
      return NextResponse.json({ error: "DB no disponible" }, { status: 503 });
    }

    const { training, sessionConfig } = payload;
    let practice = null;
    try {
      practice = await loadPracticeContext(
        prisma,
        session.user.id,
        training.offerId,
        training.productName,
      );
    } catch {
      await ensureWorkspaceTables(prisma);
      practice = await loadPracticeContext(
        prisma,
        session.user.id,
        training.offerId,
        training.productName,
      );
    }
    if (!practice?.offer?.productName.trim()) {
      return NextResponse.json(
        {
          error: "Primero guarda tu oferta en Ofertas.",
          code: SETUP_REQUIRED_CODE,
        },
        { status: 403 },
      );
    }

    const trainingWithOffer = {
      ...training,
      productName: practice.offer.productName,
      productDescription: practice.offer.productDescription.slice(0, 1600),
      pitchSummary: (training.pitchSummary || practice.offer.pitchSummary || "").slice(0, 800),
      offerBonuses: practice.offer.bonuses,
      leadPlaybook: practice.playbook,
    };

    if (training.practiceKind === "replay") {
      const source = training.replayCall?.source;
      const sourceId = training.replayCall?.sourceId;
      if (!source || !sourceId) {
        return NextResponse.json(
          { error: "Elige la llamada que no cerró." },
          { status: 400 },
        );
      }
      const replay = await loadReplayCall(
        prisma,
        session.user.id,
        source,
        sourceId,
      );
      if (!replay) {
        return NextResponse.json(
          { error: "No encontré esa llamada para recrearla." },
          { status: 404 },
        );
      }
      trainingWithOffer.replayCall = replay;
      trainingWithOffer.practiceKind = "replay";
      trainingWithOffer.prospectProfile = generateProspectProfile(
        trainingWithOffer.productName,
        trainingWithOffer.productDescription,
        trainingWithOffer.difficulty,
        trainingWithOffer.language,
        practice.playbook,
        trainingWithOffer.practiceFocus,
        replay,
      );
    }

    const guide = liveGuideForPrompt(practice.liveGuide).slice(0, 1500);
    const instructions = [buildProspectInstructions(trainingWithOffer, "closer", practice.playbook), guide]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 12000);

    const roomName = `closer-${Math.random().toString(36).slice(2, 10)}`;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
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
      temperature: 0.7,
      max_output_tokens: maxTokensForProspect(
        training.difficulty,
        training.prospectProfile?.talkStyle,
      ),
      training_mode: training.callSection,
      product_name: practice.offer.productName,
      difficulty: training.difficulty,
      language: training.language,
    };
    const metadataJson = JSON.stringify(metadata);

    const at = new AccessToken(apiKey, apiSecret, {
      identity: "closer",
      metadata: metadataJson,
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      canUpdateOwnMetadata: true,
    });

    // The worker that is actually running (LiveKit Cloud, last green deploy
    // 2026-09-15) joins the room on dispatch and then waits forever for a
    // participant before it opens Gemini. It never reads job metadata and it
    // never leaves an empty room. Prefetch and hover call this route, so
    // creating the room here would pin that worker until the platform kills it.
    // Dispatch only when the closer's token is used to join.
    // Set LIVEKIT_PREDISPATCH=1 only after a green deploy of the worker that
    // leaves if nobody joins within 75s.
    let dispatched = false;
    if (process.env.LIVEKIT_PREDISPATCH === "1") {
      try {
        dispatched = await dispatchPracticeAgent({
          url: livekitUrl,
          apiKey,
          apiSecret,
          roomName,
          metadata: metadataJson,
        });
      } catch (error) {
        console.error("practice dispatch", error);
      }
    }

    if (!dispatched) {
      at.roomConfig = new RoomConfiguration({
        name: roomName,
        agents: [
          new RoomAgentDispatch({
            agentName: "closer-trainer",
            metadata: metadataJson,
          }),
        ],
      });
    }

    return NextResponse.json({
      accessToken: await at.toJwt(),
      url: livekitUrl,
      prepMs: Date.now() - started,
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
