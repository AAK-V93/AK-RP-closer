import { NextResponse } from "next/server";
import dotenv from "dotenv";
import path from "path";
import { generateGeminiParts } from "@/lib/gemini";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

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

    const prompt = `Extrae la oferta comercial COMPLETA de este documento. Responde SOLO JSON:
{
  "productName": "nombre corto",
  "aliases": ["CM", "otro alias"],
  "productDescription": "qué es, a quién, qué incluye, resultado. 80-180 palabras",
  "pitchSummary": "3-6 líneas para practicar el cierre",
  "listPrice": 12000,
  "currency": "USD",
  "fxRate": null,
  "altPrices": [{"label":"contado 7 días","amount":10000}],
  "paymentModes": [{"name":"Contado 7 días","details":"saldo a 7 días"},{"name":"Reserva","details":"mínimo 2000"}],
  "deadlines": [{"name":"Completar inicial","days":7,"appliesTo":"reserva"}],
  "bonuses": [{"name":"Visita consultor","condition":"si cierra en la llamada"}],
  "paymentDetails": "cuentas, voucher, lo que sirva para cobrar",
  "duration": "6 meses",
  "commission": {"pctBase":0.03,"umbralAcumuladoUsd":70000,"pctSobreUmbral":0.05,"base":"cash_collected","periodoAcumulacion":"mensual"}
}
Números sin símbolos. Si un campo no aparece, null o []. No inventes comisión si no está. Idioma: el del documento.`;

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

    const text = await generateGeminiParts(parts, 0.2);

    const parsed = JSON.parse(text) as Record<string, unknown>;
    const commercial = {
      aliases: Array.isArray(parsed.aliases) ? parsed.aliases.map(String) : [],
      listPrice: parsed.listPrice == null ? null : Number(parsed.listPrice),
      currency: String(parsed.currency || "USD"),
      fxRate: parsed.fxRate == null ? null : Number(parsed.fxRate),
      altPrices: parsed.altPrices,
      paymentModes: parsed.paymentModes,
      deadlines: parsed.deadlines,
      bonuses: parsed.bonuses,
      paymentDetails: String(parsed.paymentDetails || ""),
      duration: String(parsed.duration || ""),
      commission: parsed.commission || null,
    };

    return NextResponse.json({
      productName: String(parsed.productName || "").trim() || file.name.replace(/\.[^.]+$/, ""),
      productDescription: String(parsed.productDescription || "").trim(),
      pitchSummary: String(parsed.pitchSummary || "").trim(),
      commercial,
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
