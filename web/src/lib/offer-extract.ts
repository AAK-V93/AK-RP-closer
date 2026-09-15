import { generateGeminiJson, generateGeminiParts } from "@/lib/gemini";
import {
  emptyCommercial,
  parseCommercial,
  parseCommissionFromText,
  type ExtractedOffer,
  type ExtractedOfferBatch,
} from "@/lib/offer-commercial";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 6;
const MAX_OFFERS = 8;

export const OFFER_EXTRACT_PROMPT = `Eres un extractor de ofertas comerciales para un closer. Del documento o texto, saca TODO lo que sirva para vender y para calcular comisión.

PRIMERO decide si hay UNA oferta o VARIAS:
- VARIAS: programas/productos distintos (nombres distintos, promesas distintas, o se venden por separado). Cada uno es un ítem en "offers".
- UNA: un solo programa, aunque tenga planes, precios o formas de pago. Los planes van en altPrices/paymentModes, no como ofertas extra.
No inventes un segundo programa. Si dudas, asume UNA y pregunta en "questions".

La comisión A MENUDO NO es un % fijo. Puede depender de:
- en cuánto tiempo paga el lead
- si paga de contado, reserva, cuotas, transferencia, etc.
- umbrales de volumen, si aparecen

Copia la regla en "notes" con las palabras del closer/documento. Si hay tramos, llénalos en "tiers". NO inventes 3% ni umbral 70,000. Si no hay comisión, commission = null.

Después de extraer, llena "questions" (2-4) para que el closer confirme: nombres exactos, si es una o varias, y si juntaste o separaste mal.

Responde SOLO JSON:
{
  "assumption": "una",
  "questions": ["¿El nombre correcto es …?", "¿Esto es un solo programa o varios?"],
  "offers": [
    {
      "productName": "nombre corto del programa",
      "aliases": ["alias"],
      "productDescription": "qué es, a quién, qué incluye, resultado. 80-180 palabras",
      "pitchSummary": "3-6 líneas para practicar el cierre",
      "listPrice": 12000,
      "currency": "USD",
      "fxRate": null,
      "altPrices": [{"label":"contado 7 días","amount":10000}],
      "paymentModes": [{"name":"Contado 7 días","details":"saldo a 7 días"}],
      "deadlines": [{"name":"Completar inicial","days":7,"appliesTo":"reserva"}],
      "bonuses": [{"name":"Visita consultor","condition":"si cierra en la llamada"}],
      "paymentDetails": "cuentas, voucher, lo que sirva para cobrar",
      "duration": "6 meses",
      "commission": {
        "notes": "narrativa completa: % según plazo y forma de pago",
        "tiers": [
          {"when":"paga de contado en 7 días","label":"Contado 7d","pct":0.08,"daysMax":7,"paymentMode":"Contado 7 días"}
        ],
        "pctBase": null,
        "umbralAcumuladoUsd": null,
        "pctSobreUmbral": null,
        "base": "cash_collected",
        "periodoAcumulacion": "mensual"
      }
    }
  ]
}
Números sin símbolos. pct en fracción (8% → 0.08). Si un campo no aparece: null o []. Idioma: el del texto. Máximo ${MAX_OFFERS} ofertas.`;

export function parseGeminiJsonObject(text: string): Record<string, unknown> {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```$/u, "")
    .trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}

export function extractedFromParsed(
  parsed: Record<string, unknown>,
  fallbackName = "Oferta",
  sourceText = "",
): ExtractedOffer {
  const commercial = parseCommercial({
    aliases: parsed.aliases,
    listPrice: parsed.listPrice,
    currency: parsed.currency,
    fxRate: parsed.fxRate,
    altPrices: parsed.altPrices,
    paymentModes: parsed.paymentModes,
    deadlines: parsed.deadlines,
    bonuses: parsed.bonuses,
    paymentDetails: parsed.paymentDetails,
    duration: parsed.duration,
    commission: parsed.commission,
    sourceText: sourceText.slice(0, 8000),
  });
  const description = String(parsed.productDescription || "").trim();
  const name = String(parsed.productName || "").trim() || fallbackName;
  return {
    productName: name,
    productDescription:
      description.length >= 20 ? description : sourceText.slice(0, 1200) || description,
    pitchSummary: String(parsed.pitchSummary || "").trim(),
    commercial,
  };
}

function defaultQuestions(offers: ExtractedOffer[], assumption: "una" | "varias") {
  const names = offers.map((row) => row.productName).filter(Boolean);
  if (assumption === "varias" || offers.length > 1) {
    return [
      `Encontré ${offers.length} ofertas: ${names.join(", ") || "sin nombre"}. ¿Son programas distintos o es uno solo con varios planes?`,
      "¿Los nombres están bien? Si hay que corregir uno, dímelo.",
    ];
  }
  return [
    `¿Se llama «${names[0] || "esta oferta"}»?`,
    "Si vendes más de un programa, dímelo y lo separamos.",
  ];
}

export function parsedToBatch(
  parsed: Record<string, unknown>,
  fallbackName = "Oferta",
  sourceText = "",
): ExtractedOfferBatch {
  const rawOffers = Array.isArray(parsed.offers) ? parsed.offers : [];
  let offers: ExtractedOffer[] = rawOffers
    .filter((item) => item && typeof item === "object")
    .slice(0, MAX_OFFERS)
    .map((item, index) =>
      extractedFromParsed(
        item as Record<string, unknown>,
        index === 0 ? fallbackName : `Oferta ${index + 1}`,
        sourceText,
      ),
    );
  if (!offers.length && (parsed.productName || parsed.productDescription || parsed.commission)) {
    offers = [extractedFromParsed(parsed, fallbackName, sourceText)];
  }
  if (!offers.length) {
    offers = [heuristicExtract(sourceText || fallbackName)];
  }
  const assumption: "una" | "varias" =
    offers.length > 1 || String(parsed.assumption || "").toLowerCase().includes("varia")
      ? "varias"
      : "una";
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.map(String).map((row) => row.trim()).filter(Boolean).slice(0, 6)
    : [];
  return {
    offers,
    assumption: offers.length > 1 ? "varias" : assumption,
    questions: questions.length ? questions : defaultQuestions(offers, assumption),
  };
}

export function heuristicExtract(text: string): ExtractedOffer {
  const source = text.trim();
  const commercial = emptyCommercial();
  commercial.sourceText = source.slice(0, 8000);
  commercial.commission = parseCommissionFromText(source);
  const priceMatch = source.match(
    /(?:lista|precio|ticket|usd|\$)\s*:?\s*(\d[\d.\s,]{2,})/i,
  );
  if (priceMatch) {
    const n = Number(priceMatch[1].replace(/[^\d]/g, ""));
    if (n > 50) commercial.listPrice = n;
  }
  const modes: { name: string; details: string }[] = [];
  if (/contado/i.test(source)) modes.push({ name: "Contado", details: "" });
  if (/reserva/i.test(source)) modes.push({ name: "Reserva", details: "" });
  if (/cuota/i.test(source)) modes.push({ name: "Cuotas", details: "" });
  commercial.paymentModes = modes;
  const firstLine =
    source
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 2 && line.length <= 70) || "Oferta";
  const description = source.slice(0, 1200);
  return {
    productName: firstLine.length <= 70 ? firstLine : "Oferta",
    productDescription: description.length >= 20 ? description : `${description} — oferta`.slice(0, 80),
    pitchSummary: "",
    commercial,
  };
}

export function heuristicBatch(text: string): ExtractedOfferBatch {
  const offer = heuristicExtract(text);
  return {
    offers: [offer],
    assumption: "una",
    questions: defaultQuestions([offer], "una"),
  };
}

export function offerBatchRecap(batch: ExtractedOfferBatch): string {
  const names = batch.offers.map((row) => row.productName).filter(Boolean);
  const head =
    batch.assumption === "varias" || batch.offers.length > 1
      ? `Encontré ${batch.offers.length} ofertas: ${names.join(", ")}.`
      : `Encontré una oferta: ${names[0] || "sin nombre"}.`;
  const qs = batch.questions.map((row) => `· ${row}`).join("\n");
  return `${head}\nConfirma si los nombres están bien y si es una o varias.\n${qs}`;
}

export type OfferExtractFile = {
  name: string;
  mime: string;
  buffer: Buffer;
};

export async function extractOfferBatchFromInput(args: {
  text?: string;
  files?: OfferExtractFile[];
}): Promise<ExtractedOfferBatch> {
  const text = (args.text || "").trim();
  const files = (args.files || []).slice(0, MAX_FILES);
  if (!text && !files.length) {
    throw new Error("Pega un texto o sube un documento");
  }
  for (const file of files) {
    if (file.buffer.length > MAX_BYTES) {
      throw new Error(`${file.name} supera 4 MB`);
    }
  }

  const parts: object[] = [{ text: OFFER_EXTRACT_PROMPT }];
  if (text) {
    parts.push({ text: `\n\n--- TEXTO ---\n${text.slice(0, 24000)}` });
  }
  for (const file of files) {
    const mime = file.mime || "application/octet-stream";
    const isText =
      mime.startsWith("text/") ||
      file.name.endsWith(".md") ||
      file.name.endsWith(".txt");
    if (isText) {
      parts.push({
        text: `\n\n--- ${file.name} ---\n${file.buffer.toString("utf8").slice(0, 20000)}`,
      });
    } else {
      parts.push({
        inlineData: {
          mimeType:
            mime === "application/octet-stream" ? "application/pdf" : mime,
          data: file.buffer.toString("base64"),
        },
      });
    }
  }

  try {
    const raw = await generateGeminiParts(parts, 0.2, 8192);
    const parsed = parseGeminiJsonObject(raw);
    const fallbackName =
      files[0]?.name.replace(/\.[^.]+$/, "") || "Oferta";
    const batch = parsedToBatch(parsed, fallbackName, text);
    return padBatchDescriptions(batch, text);
  } catch (error) {
    if (text.length >= 20) return heuristicBatch(text);
    throw error instanceof Error ? error : new Error("No se pudo extraer la oferta");
  }
}

function padBatchDescriptions(batch: ExtractedOfferBatch, text: string): ExtractedOfferBatch {
  return {
    ...batch,
    offers: batch.offers.map((offer) => {
      const next = { ...offer };
      if (!next.commercial.commission && text) {
        next.commercial = {
          ...next.commercial,
          commission: parseCommissionFromText(text),
        };
      }
      if (next.productDescription.length < 20 && text.length >= 20) {
        next.productDescription = text.slice(0, 1200);
      }
      return next;
    }),
  };
}

/** @deprecated use extractOfferBatchFromInput */
export async function extractOfferFromInput(args: {
  text?: string;
  files?: OfferExtractFile[];
}): Promise<ExtractedOffer> {
  const batch = await extractOfferBatchFromInput(args);
  return batch.offers[0];
}

export async function extractOfferFromText(text: string): Promise<ExtractedOffer> {
  const batch = await extractOfferBatchFromInput({ text });
  return batch.offers[0];
}

export async function extractOfferBatchFromText(text: string): Promise<ExtractedOfferBatch> {
  return extractOfferBatchFromInput({ text });
}

export function isOfferExtractConfirm(text: string) {
  const value = text.trim();
  if (value.length > 90) return false;
  return /^(sí|si|ok|okay|correcto|confirmo|dale|va|así|asi|perfecto|yes|de acuerdo|está bien|esta bien)\b/i.test(
    value,
  );
}

export async function applyOfferExtractFeedback(
  batch: ExtractedOfferBatch,
  feedback: string,
): Promise<ExtractedOfferBatch> {
  if (isOfferExtractConfirm(feedback)) return batch;
  const prompt = `El closer responde sobre una extracción de ofertas. Ajusta nombres, une (una sola) o separa (varias) según lo que dijo. No inventes programas nuevos que no estuvieran. Si dice que es una sola, deja un solo ítem en offers.

EXTRACCIÓN PREVIA:
${JSON.stringify({
    assumption: batch.assumption,
    questions: batch.questions,
    offers: batch.offers.map((row) => ({
      productName: row.productName,
      productDescription: row.productDescription,
      pitchSummary: row.pitchSummary,
      commercial: row.commercial,
    })),
  })}

RESPUESTA DEL CLOSER:
${feedback.slice(0, 4000)}

Devuelve el mismo JSON que el extractor (assumption, questions, offers). questions puede quedar vacío si ya está confirmado.`;

  try {
    const raw = await generateGeminiJson(prompt, 0.2, 4096);
    const parsed = parseGeminiJsonObject(raw);
    const next = parsedToBatch(parsed, batch.offers[0]?.productName || "Oferta", "");
    return next.offers.length ? next : batch;
  } catch {
    return batch;
  }
}

export function fileFromBlob(file: File, buffer: Buffer): OfferExtractFile {
  return {
    name: file.name,
    mime: file.type || "application/octet-stream",
    buffer,
  };
}
