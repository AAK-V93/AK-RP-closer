// Reads who each case is and what changed, from the snippet only.
// Sheet rows with clear columns need no model; the rest go to Gemini in
// batches. Whatever comes back passes guardFigures against its snippet, and
// links come only from the source (never from the model).
import { generateGeminiJson } from "@/lib/gemini";
import { guardFigures } from "./figures";
import { type CaseFields, type CaseItem, readableWithoutModel } from "./items";
import type { ExtractedCase } from "./merge";

export const EXTRACT_BATCH = 25;
/** pinned by name (no -latest alias); override with GEMINI_CASES_MODEL */
export const CASES_MODEL = "gemini-3.6-flash";

export type ModelCall = (prompt: string) => Promise<string>;

export function geminiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

const defaultModel: ModelCall = (prompt) =>
  generateGeminiJson(prompt, 0.1, 8192, {
    models: [process.env.GEMINI_CASES_MODEL?.trim() || CASES_MODEL],
    timeoutMs: 45_000,
  });

export function extractPrompt(items: CaseItem[]) {
  const blocks = items.map((it, i) => `### ${i}\n${it.snippet}`).join("\n\n");
  return `Eres un asistente que ordena casos de éxito de una oferta.
Cada bloque es el texto de un caso (una fila de una hoja o el título y la descripción de un video).
Para cada bloque devuelve: name (quién es, nombre o descripción corta), profile (a qué se dedica o quién es),
before (cómo estaba antes), result (qué logró), quote (una frase textual suya, si la hay).
Reglas: usa solo lo que dice el texto. Si algo no está, pon null. Nunca inventes cifras ni montos:
copia los números exactamente como aparecen. Escribe en español.
Si un bloque no es un caso de éxito (por ejemplo un video de otro tema), pon name null.
Responde solo JSON: {"cases":[{"i":0,"name":...,"profile":...,"before":...,"result":...,"quote":...}]}

${blocks}`;
}

type ModelCase = { i?: number; name?: unknown; profile?: unknown; before?: unknown; result?: unknown; quote?: unknown };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Final fields: hints win where present, everything checked against the snippet. */
export function finalize(item: CaseItem, fromModel: Partial<CaseFields> | null): CaseFields {
  const pick = (f: keyof CaseFields) => guardFigures(item.hints[f] ?? fromModel?.[f] ?? null, item.snippet);
  return {
    name: pick("name"),
    profile: pick("profile"),
    before: pick("before"),
    result: pick("result"),
    quote: pick("quote"),
    mediaUrl: item.hints.mediaUrl,
  };
}

export function parseModelCases(raw: string, count: number): Array<Partial<CaseFields> | null> {
  const out: Array<Partial<CaseFields> | null> = Array.from({ length: count }, () => null);
  let data: { cases?: ModelCase[] } | ModelCase[];
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  const list = Array.isArray(data) ? data : data.cases ?? [];
  list.forEach((c, idx) => {
    const i = typeof c.i === "number" ? c.i : idx;
    if (i < 0 || i >= count) return;
    out[i] = { name: str(c.name), profile: str(c.profile), before: str(c.before), result: str(c.result), quote: str(c.quote) };
  });
  return out;
}

/**
 * Items → cases. Without GEMINI_API_KEY the cases keep what the source says
 * plainly (sheet columns, video title) and the person fills the rest in review.
 */
export async function extractCases(
  items: CaseItem[],
  options: { model?: ModelCall | null; titles?: Map<string, string> } = {},
): Promise<{ cases: ExtractedCase[]; modelCalls: number }> {
  const model = options.model === undefined ? (geminiAvailable() ? defaultModel : null) : options.model;
  const need = model ? items.filter((it) => !readableWithoutModel(it)) : [];
  const fromModel = new Map<string, Partial<CaseFields> | null>();
  let modelCalls = 0;
  for (let i = 0; i < need.length; i += EXTRACT_BATCH) {
    const batch = need.slice(i, i + EXTRACT_BATCH);
    try {
      modelCalls += 1;
      const parsed = parseModelCases(await model!(extractPrompt(batch)), batch.length);
      batch.forEach((it, j) => fromModel.set(it.externalKey, parsed[j]));
    } catch {
      // keep going: these cases stay with what the source says plainly
    }
  }
  const cases: ExtractedCase[] = [];
  for (const it of items) {
    const m = fromModel.get(it.externalKey) ?? null;
    if (fromModel.has(it.externalKey) && m && m.name === null && !it.hints.name) continue; // not a case
    const fields = finalize(it, m);
    if (!fields.name) fields.name = options.titles?.get(it.externalKey) ?? null;
    cases.push({ externalKey: it.externalKey, snippet: it.snippet, fields });
  }
  return { cases, modelCalls };
}
