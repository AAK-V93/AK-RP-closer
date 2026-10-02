import { generateGeminiJson, generateGeminiParts } from "@/lib/gemini";
import { isInventedOfferLabel, isPriceLabel, nameHintsFromText } from "@/lib/offer-name";
import {
  explicitBonusLines,
  explicitPriceLines,
  guardOfferContent,
  linesFromTextItems,
  sanitizeCommissionQuestions,
  separateMoneyTokens,
} from "@/lib/offer-amounts";
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

Copia la regla en "notes" con las palabras del closer/documento. Si hay tramos, llénalos en "tiers". NO inventes 3% ni umbral 70,000. Si no hay comisión, commission = null. Nunca asumas comisión. Un porcentaje es comisión solo si está junto a "comisión", "comisión del closer" o "pago al closer". "69% de probabilidad de éxito" o "casos de éxito" NO es comisión. Copia cada precio tal como está en su línea (USD 1.597 no se pega con el 69 de la línea siguiente).

Después de extraer, llena "questions" (2-4). Cada pregunta afirma lo que entendiste y termina en "¿Es así?" o "¿Lo dejo vacío?". Prohibido preguntar en abierto o en negativo: no uses "¿se debe confirmar…?", "¿porcentaje fijo o tramos?", "¿cómo se maneja?" ni "¿X no está especificado?". Si un dato no venía, dilo en afirmativo. Ejemplo: "No encontré los porcentajes de comisión. ¿Los dejo vacíos?" Ejemplo con dato: "La comisión queda en 10% sobre lo cobrado. ¿Es así?"

Responde SOLO JSON:
{
  "assumption": "una",
  "questions": ["La comisión queda en 10% sobre lo cobrado. ¿Es así?", "Es un solo programa. ¿Es así?"],
  "offers": [
    {
      "productName": "nombre corto del programa",
      "aliases": ["alias"],
      "icp": "quién compra esto, 1-2 frases. Dedúcelo del documento; si no alcanza, null. No inventes un avatar.",
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
  if (!commercial.commission) {
    const line = sourceText
      .split(/\n/)
      .map((row) => row.trim())
      .find((row) => /comisi[oó]n/i.test(row) && /\d+\s*%/.test(row));
    if (line) commercial.commission = parseCommissionFromText(line);
  }
  const description = String(parsed.productDescription || "").trim();
  let name = String(parsed.productName || "").trim() || fallbackName;
  if (isPriceLabel(name) || isInventedOfferLabel(name)) {
    const better = nameHintsFromText(`${sourceText}\n${description}`).find(
      (hint) => !isPriceLabel(hint) && !isInventedOfferLabel(hint),
    );
    if (better) name = better;
  }
  const icp = String(parsed.icp || "").trim();
  return {
    productName: name,
    productDescription:
      description.length >= 20 ? description : sourceText.slice(0, 1200) || description,
    pitchSummary: String(parsed.pitchSummary || "").trim(),
    icp,
    commercial,
  };
}

/**
 * A negative yes/no ("¿los porcentajes no están especificados?") makes Sí mean
 * the opposite of what a closer expects. Restate the gap and ask to leave it empty.
 */
export function rephraseOfferQuestion(question: string): string {
  const text = question.replace(/\s+/g, " ").trim();
  if (!text) return text;
  const negated = text.match(
    /¿?\s*((?:los|las|el|la|un|una)\s+)?(.+?)\s+no\s+(?:est[aá]n?|estaban|estaba|aparecen?|figuran?|vienen?|viene|hay|se\s+(?:especific\w*|mencion\w*|detall\w*|indic\w*|inclu\w*))/i,
  );
  if (!negated) return text;
  const article = (negated[1] || "").trim().toLowerCase();
  const subject = negated[2]
    .replace(/[¿?]/g, "")
    .replace(/\s+(?:en el documento|en el texto|del documento|del texto).*$/i, "")
    .trim();
  const phrase = [article, subject].filter(Boolean).join(" ");
  const lower = phrase.charAt(0).toLowerCase() + phrase.slice(1);
  return `No encontré ${lower} en el documento. ¿Lo dejo vacío?`;
}

function defaultQuestions(offers: ExtractedOffer[], assumption: "una" | "varias") {
  const names = offers.map((row) => row.productName).filter(Boolean);
  if (assumption === "varias" || offers.length > 1) {
    return [
      `Encontré ${offers.length} ofertas: ${names.join(", ") || "sin nombre"}. ¿Son programas distintos o es uno solo con varios planes?`,
      "¿Los nombres están bien? Si hay que corregir uno, dímelo.",
    ];
  }
  const rule = offers[0]?.commercial.commission;
  const pct =
    rule && rule.pctBase > 0 ? `${Math.round(rule.pctBase * 1000) / 10}%` : "";
  return [
    pct
      ? `La comisión queda en ${pct} sobre lo cobrado. ¿Es así?`
      : "No encontré un porcentaje de comisión. ¿La dejo vacía?",
    `Se llama «${names[0] || "esta oferta"}». ¿Es así?`,
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
    ? parsed.questions
        .map(String)
        .map((row) => rephraseOfferQuestion(row.trim()))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const guarded = offers.map((offer) => guardOfferContent(offer, sourceText));
  const asked = sanitizeCommissionQuestions(
    questions.length ? questions : defaultQuestions(guarded, assumption),
    sourceText,
  );
  const hasRule = guarded.some((row) => Boolean(row.commercial.commission));
  return {
    offers: guarded,
    assumption: guarded.length > 1 ? "varias" : assumption,
    questions: ensureCommissionQuestion(asked, hasRule),
  };
}

/** The review always asks about commission, even when the model skipped it. */
export function ensureCommissionQuestion(questions: string[], hasRule: boolean) {
  if (questions.some((row) => /comisi/i.test(row))) return questions.slice(0, 6);
  const line = hasRule
    ? "La comisión quedó como está en el documento. ¿Es así?"
    : "No encontré un porcentaje de comisión. ¿La dejo vacía?";
  return [line, ...questions].slice(0, 6);
}

export function heuristicExtract(text: string): ExtractedOffer {
  const source = text.trim();
  const commercial = emptyCommercial();
  commercial.sourceText = source.slice(0, 8000);
  commercial.commission = parseCommissionFromText(source);
  const priceMatch = separateMoneyTokens(source).match(
    /(?:lista|precio|ticket|usd|\$)[ \t]*:?[ \t]*(\d{1,3}(?:\.\d{3})+|\d{2,})/i,
  );
  if (priceMatch) {
    const token = priceMatch[1] || "";
    const n = /^\d{1,3}(\.\d{3})+$/.test(token)
      ? Number(token.replace(/\./g, ""))
      : Number(token);
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
      .find((line) => line.length > 2 && line.length <= 70 && !isPriceLabel(line)) || "Oferta";
  const description = source.slice(0, 1200);
  return {
    productName: firstLine.length <= 70 ? firstLine : "Oferta",
    productDescription: description.length >= 20 ? description : `${description} — oferta`.slice(0, 80),
    pitchSummary: "",
    icp: "",
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
  return `${head}\nConfirma cada bloque (nombre, ICP, precios, pagos, bonos, comisión, datos de pago): Sí o Corregir. La comisión no la asumo.\n${qs}`;
}

export type OfferExtractFile = {
  name: string;
  mime: string;
  buffer: Buffer;
};

export function clipOfferText(text: string, max = 18000) {
  const raw = text.trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, 12000)}\n\n…\n\n${raw.slice(-5000)}`;
}

function isPdfFile(file: OfferExtractFile) {
  const mime = file.mime || "";
  return mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isPlainTextFile(file: OfferExtractFile) {
  const mime = file.mime || "";
  const name = file.name.toLowerCase();
  return mime.startsWith("text/") || name.endsWith(".md") || name.endsWith(".txt");
}

async function pdfPlainText(buffer: Buffer) {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages: string[] = [];
  const pageCount = pdf.numPages || 0;
  for (let number = 1; number <= pageCount; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    const items = content.items as { str?: string; transform?: number[] }[];
    const body = linesFromTextItems(items);
    const prices = explicitPriceLines(items);
    const bonuses = explicitBonusLines(items);
    pages.push(
      [body, prices.length ? prices.join("\n") : "", bonuses.length ? bonuses.join("\n") : ""]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return separateMoneyTokens(pages.filter(Boolean).join("\n")).replace(/[ \t]+\n/g, "\n").trim();
}

/** Pulls text out of PDFs so the model call is short enough for the function limit. */
export async function textFromOfferFiles(files: OfferExtractFile[]) {
  const chunks: string[] = [];
  const binaries: OfferExtractFile[] = [];
  for (const file of files.slice(0, MAX_FILES)) {
    if (file.buffer.length > MAX_BYTES) {
      throw new Error(`${file.name} supera 4 MB`);
    }
    if (isPlainTextFile(file)) {
      const text = separateMoneyTokens(file.buffer.toString("utf8")).trim();
      if (text) chunks.push(text);
      continue;
    }
    if (isPdfFile(file)) {
      try {
        const text = await pdfPlainText(file.buffer);
        if (text.length >= 40) {
          chunks.push(text);
          continue;
        }
      } catch (error) {
        console.error("pdf text", file.name, error);
      }
    }
    binaries.push(file);
  }
  return { text: clipOfferText(chunks.join("\n\n")), binaries };
}

export async function extractOfferBatchFromInput(args: {
  text?: string;
  files?: OfferExtractFile[];
}): Promise<ExtractedOfferBatch> {
  const pasted = (args.text || "").trim();
  const files = (args.files || []).slice(0, MAX_FILES);
  if (!pasted && !files.length) {
    throw new Error("Pega un texto o sube un documento");
  }
  const read = files.length ? await textFromOfferFiles(files) : { text: "", binaries: [] };
  const text = clipOfferText([pasted, read.text].filter(Boolean).join("\n\n"));
  const binaries = read.binaries;

  const parts: object[] = [{ text: OFFER_EXTRACT_PROMPT }];
  if (text) parts.push({ text: `\n\n--- TEXTO ---\n${text}` });
  for (const file of binaries) {
    const mime = file.mime || "application/octet-stream";
    parts.push({
      inlineData: {
        mimeType: mime === "application/octet-stream" || isPdfFile(file) ? "application/pdf" : mime,
        data: file.buffer.toString("base64"),
      },
    });
  }

  const fallbackName = files[0]?.name.replace(/\.[^.]+$/, "") || "Oferta";
  try {
    const raw = await generateGeminiParts(parts, 0.2, 4096, {
      timeoutMs: 40_000,
      models: ["gemini-flash-latest"],
    });
    const parsed = parseGeminiJsonObject(raw);
    const batch = parsedToBatch(parsed, fallbackName, text);
    return padBatchDescriptions(batch, text);
  } catch (error) {
    if (text.length >= 40) return heuristicBatch(text);
    throw error instanceof Error ? error : new Error("No se pudo extraer la oferta");
  }
}

function padBatchDescriptions(batch: ExtractedOfferBatch, text: string): ExtractedOfferBatch {
  return {
    ...batch,
    offers: batch.offers.map((offer) => {
      const next = { ...offer };
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
      icp: row.icp,
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
