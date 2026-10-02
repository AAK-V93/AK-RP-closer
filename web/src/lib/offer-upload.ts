import { emptyCommercial, type ExtractedOffer, type ExtractedOfferBatch } from "./offer-commercial";

export const OFFER_READ_PROGRESS = "Leyendo el documento…";
export const OFFER_EXTRACT_PROGRESS = "Extrayendo precios y comisión…";

type OfferPayload = {
  error?: string;
  details?: string;
  assumption?: string;
  questions?: unknown;
  offers?: unknown;
  productName?: string;
  productDescription?: string;
  pitchSummary?: string;
  icp?: string;
  commercial?: unknown;
  text?: string;
  needsModelFile?: boolean;
};

/** Turns a Vercel HTML timeout page into a sentence the closer can act on. */
export function offerFailureMessage(status: number, raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed) as OfferPayload;
      const error = String(data.error || "").trim();
      const details = String(data.details || "").trim();
      const blob = `${error} ${details}`;
      if (/timeout|tardó|abort|FUNCTION_INVOCATION|deadline/i.test(blob)) {
        return "La extracción tardó demasiado y se cortó. Pulsa Reintentar.";
      }
      if (error && !/unexpected token|is not valid json/i.test(error)) return error;
    } catch {
      /* The body looked like JSON and was not. */
    }
  }
  if (
    status === 502 ||
    status === 504 ||
    /an error occurred|timeout|FUNCTION_INVOCATION|gateway/i.test(trimmed)
  ) {
    return "La extracción tardó demasiado y se cortó. Pulsa Reintentar.";
  }
  return "No pude leer la respuesta del servidor. Pulsa Reintentar.";
}

async function readPayload(response: Response): Promise<OfferPayload> {
  const raw = await response.text();
  if (!response.ok) throw new Error(offerFailureMessage(response.status, raw));
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) throw new Error(offerFailureMessage(response.status, raw));
  try {
    return JSON.parse(trimmed) as OfferPayload;
  } catch {
    throw new Error(offerFailureMessage(response.status, raw));
  }
}

export type OfferExtractResult = ExtractedOfferBatch;

/**
 * Reads the file first, then asks the model. Two short calls stay inside the
 * function limit; a single PDF-inlined call was dying as an HTML error page.
 */
export async function runOfferExtraction(
  args: {
    files?: File[];
    paste?: string;
    onProgress?: (message: string) => void;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<OfferExtractResult> {
  const files = args.files || [];
  const paste = (args.paste || "").trim();
  args.onProgress?.(OFFER_READ_PROGRESS);
  const readBody = new FormData();
  readBody.set("step", "read");
  files.forEach((file) => readBody.append("files", file));
  if (paste) readBody.set("paste", paste);
  const read = await readPayload(
    await fetchImpl("/api/offer-from-doc", { method: "POST", body: readBody }),
  );
  args.onProgress?.(OFFER_EXTRACT_PROGRESS);
  const extractBody = new FormData();
  extractBody.set("paste", String(read.text || paste));
  if (read.needsModelFile) files.forEach((file) => extractBody.append("files", file));
  const data = await readPayload(
    await fetchImpl("/api/offer-from-doc", { method: "POST", body: extractBody }),
  );
  const offers: ExtractedOffer[] = Array.isArray(data.offers) && data.offers.length
    ? (data.offers as ExtractedOffer[]).map((offer) => ({
        ...offer,
        commercial: offer.commercial || emptyCommercial(),
      }))
    : data.productName
      ? [
          {
            productName: String(data.productName),
            productDescription: String(data.productDescription || ""),
            pitchSummary: String(data.pitchSummary || ""),
            icp: String(data.icp || ""),
            commercial: (data.commercial as ExtractedOffer["commercial"]) || emptyCommercial(),
          },
        ]
      : [];
  if (!offers.length) throw new Error("No encontré una oferta en ese texto");
  return {
    assumption: data.assumption === "varias" || offers.length > 1 ? "varias" : "una",
    questions: Array.isArray(data.questions) ? data.questions.map(String) : [],
    offers,
  };
}
