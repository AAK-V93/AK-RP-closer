import { NextResponse } from "next/server";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });

export async function GET() {
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  const hasLiveKit =
    Boolean(process.env.LIVEKIT_API_KEY) &&
    Boolean(process.env.LIVEKIT_API_SECRET) &&
    Boolean(process.env.LIVEKIT_URL);

  return NextResponse.json({
    hasGeminiKey,
    hasLiveKit,
    ready: hasGeminiKey && hasLiveKit,
  });
}
