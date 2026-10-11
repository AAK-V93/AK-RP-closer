import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { generateGeminiParts } from "@/lib/gemini";
import { parseGeminiJsonObject } from "@/lib/offer-extract";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof File) || file.size < 200) {
      return NextResponse.json({ error: "Graba un audio" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Audio demasiado largo" }, { status: 400 });
    }
    const mime = file.type || "audio/webm";
    const buffer = Buffer.from(await file.arrayBuffer());
    const raw = await generateGeminiParts(
      [
        {
          text: `Transcribe este audio del closer, verbatim, en el idioma que habla. Sin resumir. Devuelve SOLO JSON {"text":"..."}.`,
        },
        {
          inlineData: {
            mimeType: mime,
            data: buffer.toString("base64"),
          },
        },
      ],
      0.1,
      2048,
      { timeoutMs: 45_000, models: ["gemini-flash-latest", "gemini-flash-lite-latest"] },
    );
    const parsed = parseGeminiJsonObject(raw);
    const text = String(parsed.text || parsed.transcript || "").trim();
    if (!text) {
      return NextResponse.json({ error: "No se entendió el audio" }, { status: 422 });
    }
    return NextResponse.json({ text });
  } catch (error) {
    console.error("hub transcribe", error);
    return NextResponse.json(
      { error: "No pude transcribir. Prueba otra vez o escribe." },
      { status: 500 },
    );
  }
}
