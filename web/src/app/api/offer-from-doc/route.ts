import { NextResponse } from "next/server";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
    if (!geminiApiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "El archivo supera 4 MB" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "application/octet-stream";
    const isText =
      mime.startsWith("text/") ||
      file.name.endsWith(".md") ||
      file.name.endsWith(".txt");

    const prompt = `Extrae la oferta comercial de este documento. Responde SOLO JSON:
{"productName":"nombre corto de la oferta","productDescription":"qué es, a quién ayuda, qué incluye, ticket si aparece, resultado prometido. 80-180 palabras.","pitchSummary":"resumen de 3-6 líneas para un closer que va a practicar el cierre"}
Si no es una oferta, inventa lo mínimo fiel al texto. Idioma: el del documento.`;

    const parts: object[] = isText
      ? [{ text: `${prompt}\n\n---\n${buffer.toString("utf8").slice(0, 20000)}` }]
      : [
          { text: prompt },
          {
            inlineData: {
              mimeType: mime === "application/octet-stream" ? "application/pdf" : mime,
              data: buffer.toString("base64"),
            },
          },
        ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        { error: "No se pudo leer el documento", details },
        { status: 502 },
      );
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return NextResponse.json(
        { error: "Respuesta vacía al leer el documento" },
        { status: 502 },
      );
    }

    const parsed = JSON.parse(text) as {
      productName?: string;
      productDescription?: string;
      pitchSummary?: string;
    };

    return NextResponse.json({
      productName: parsed.productName?.trim() || file.name.replace(/\.[^.]+$/, ""),
      productDescription: parsed.productDescription?.trim() || "",
      pitchSummary: parsed.pitchSummary?.trim() || "",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Error al procesar el documento",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
