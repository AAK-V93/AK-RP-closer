// runCallBrief (plan 2.7): ONE model call per call, from the Fathom summary +
// action items + a transcript excerpt (last ~15 min and the money/date
// windows). Prompt D1 and schema D2 (evaluacion-agente-central §D), plus
// «una_linea» and «aprendizajes» so CoachInsight costs no extra call.
// The model is injectable: tests never call Gemini.
import { z } from "zod";
import { generateGeminiJson } from "@/lib/gemini";
import { timestampSeconds, type Invitee } from "./meeting";

export const BRIEF_VERSION = 1;
/** pinned by name (no -latest alias); override with GEMINI_BRIEF_MODEL */
export const BRIEF_MODEL = "gemini-3.6-flash";
const TAIL_SEC = 15 * 60;
const TAIL_CHARS = 12_000;
const WINDOW_CHARS = 6_000;

export type ModelCall = (prompt: string, schema: object) => Promise<string>;

export function briefModelAvailable() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export const defaultBriefModel: ModelCall = (prompt, schema) =>
  generateGeminiJson(prompt, 0.2, 8192, {
    models: [process.env.GEMINI_BRIEF_MODEL?.trim() || BRIEF_MODEL],
    timeoutMs: 45_000,
    responseSchema: schema,
  });

// ---------- schema D2 (+ una_linea, aprendizajes) ----------

const S = (t: string) => ({ type: [t, "null"] });
const AGENDA = ["SHOW", "CIERRE VENTA", "ACUERDO SIN PAGO", "REPROGRAMA", "NO SHOW", "AGENDADO", "INTERNA", "NO_COMERCIAL"] as const;
const ESTADO_LEAD = ["cerrado", "pendiente_pago", "decidiendo", "reagendar", "perdido"] as const;
const ROL = ["el_mismo", "pareja", "socio", "familiar", "otro"] as const;
const CONF_KEYS = [
  "cliente_real", "estado_agenda", "estado_lead", "producto", "venta_total", "cash_collected",
  "modo_pago", "requiere_seguimiento", "tipo_seguimiento", "proximo_seguimiento", "acuerdo_seguimiento", "decisor",
] as const;

/** D2 as JSON Schema (type arrays with "null"), verbatim field names. */
export const BRIEF_JSON_SCHEMA = {
  type: "object",
  required: [
    "una_linea", "cliente_real", "estado_agenda", "estado_lead", "producto", "venta_total", "cash_collected",
    "saldo_pendiente", "moneda", "modo_pago", "decisor", "promesas", "requiere_seguimiento",
    "tipo_seguimiento", "proximo_seguimiento", "acuerdo_seguimiento", "notas_crm", "objeciones", "evidencia",
    "citas", "confianza", "requiere_revision_humana", "motivo_revision", "faltantes", "aprendizajes",
  ],
  properties: {
    una_linea: { type: "string", description: "Máximo 140 caracteres: qué pasó y qué sigue." },
    cliente_real: S("string"),
    estado_agenda: { type: ["string", "null"], enum: [...AGENDA, null] },
    estado_lead: { type: ["string", "null"], enum: [...ESTADO_LEAD, null] },
    producto: S("string"),
    venta_total: S("number"),
    cash_collected: S("number"),
    saldo_pendiente: S("number"),
    moneda: S("string"),
    modo_pago: S("string"),
    decisor: {
      type: "object",
      required: ["nombre", "rol", "presente", "cita", "timestamp"],
      properties: {
        nombre: S("string"),
        rol: { type: ["string", "null"], enum: [...ROL, null] },
        presente: S("boolean"),
        cita: S("string"),
        timestamp: S("string"),
      },
    },
    promesas: {
      type: "array",
      items: {
        type: "object",
        required: ["lado", "que", "fecha", "fecha_texto", "cita", "timestamp", "confianza"],
        properties: {
          lado: { type: "string", enum: ["closer", "cliente"] },
          que: { type: "string" },
          fecha: S("string"),
          fecha_texto: S("string"),
          cita: S("string"),
          timestamp: S("string"),
          confianza: { type: "integer" },
        },
      },
    },
    requiere_seguimiento: S("boolean"),
    tipo_seguimiento: S("string"),
    proximo_seguimiento: S("string"),
    acuerdo_seguimiento: S("string"),
    notas_crm: S("string"),
    objeciones: { type: "array", items: { type: "string" } },
    razon_no_cierre: S("string"),
    etapa_perdida: S("string"),
    calificado: S("boolean"),
    canal_contacto: S("string"),
    telefono: S("string"),
    email: S("string"),
    evidencia: {
      type: "object",
      properties: {
        identidad: S("string"), cierre: S("string"), venta_total: S("string"),
        cash_collected: S("string"), modo_pago: S("string"), seguimiento: S("string"),
      },
    },
    citas: {
      type: "array",
      items: {
        type: "object",
        required: ["campo", "texto", "timestamp", "fuente"],
        properties: {
          campo: { type: "string" },
          texto: { type: "string" },
          timestamp: S("string"),
          fuente: { type: "string", enum: ["resumen", "accion", "transcripcion"] },
        },
      },
    },
    confianza: {
      type: "object",
      description: "0-100 por campo.",
      properties: Object.fromEntries(CONF_KEYS.map((k) => [k, { type: "integer" }])),
    },
    requiere_revision_humana: { type: "boolean" },
    motivo_revision: S("string"),
    faltantes: { type: "array", items: { type: "string" } },
    aprendizajes: {
      type: "array",
      items: {
        type: "object",
        required: ["tipo", "texto"],
        properties: { tipo: { type: "string", enum: ["BIEN", "MEJORAR"] }, texto: { type: "string" } },
      },
    },
  },
} as const;

type JsonSchema = { [k: string]: unknown };

/**
 * JSON Schema → Gemini responseSchema (OpenAPI subset): `type: [x, "null"]`
 * becomes `type: x, nullable: true`, null leaves enums, and only the keywords
 * Gemini documents are kept (type, nullable, enum, description, properties,
 * required, items, propertyOrdering).
 */
export function toGeminiSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  const t = schema.type;
  if (Array.isArray(t)) {
    const real = t.filter((x) => x !== "null");
    out.type = real[0];
    if (real.length !== t.length) out.nullable = true;
  } else if (t) out.type = t;
  if (typeof schema.description === "string") out.description = schema.description;
  if (Array.isArray(schema.enum)) out.enum = schema.enum.filter((v) => v !== null);
  if (schema.properties && typeof schema.properties === "object") {
    const props = schema.properties as Record<string, JsonSchema>;
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.propertyOrdering = Object.keys(props);
  }
  if (Array.isArray(schema.required)) out.required = schema.required;
  if (schema.items && typeof schema.items === "object") out.items = toGeminiSchema(schema.items as JsonSchema);
  return out;
}

export const BRIEF_GEMINI_SCHEMA = toGeminiSchema(BRIEF_JSON_SCHEMA as unknown as JsonSchema);

// ---------- validation ----------

const str = z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null));
const num = z.number().finite().nullish().transform((v) => (v === undefined ? null : v));
const bool = z.boolean().nullish().transform((v) => (v === undefined ? null : v));
const strList = z.array(z.string()).nullish().transform((v) => (v ?? []).map((s) => s.trim()).filter(Boolean));
const oneOf = <T extends readonly [string, ...string[]]>(vals: T) =>
  z.string().nullish().transform((v) => ((vals as readonly string[]).includes(v ?? "") ? (v as T[number]) : null));

const BriefZ = z.object({
  una_linea: str,
  cliente_real: str,
  estado_agenda: oneOf(AGENDA),
  estado_lead: oneOf(ESTADO_LEAD),
  producto: str,
  venta_total: num,
  cash_collected: num,
  saldo_pendiente: num,
  moneda: str,
  modo_pago: str,
  decisor: z
    .object({ nombre: str, rol: oneOf(ROL), presente: bool, cita: str, timestamp: str })
    .nullish()
    .transform((v) => v ?? { nombre: null, rol: null, presente: null, cita: null, timestamp: null }),
  promesas: z
    .array(z.object({
      lado: z.enum(["closer", "cliente"]),
      que: z.string(),
      fecha: str, fecha_texto: str, cita: str, timestamp: str,
      confianza: z.number().nullish().transform((v) => Math.max(0, Math.min(100, Math.round(v ?? 0)))),
    }))
    .nullish()
    .transform((v) => v ?? []),
  requiere_seguimiento: bool,
  tipo_seguimiento: str,
  proximo_seguimiento: str,
  acuerdo_seguimiento: str,
  notas_crm: str,
  objeciones: strList,
  razon_no_cierre: str,
  etapa_perdida: str,
  calificado: bool,
  canal_contacto: str,
  telefono: str,
  email: str,
  evidencia: z.record(z.string(), z.string().nullable()).nullish().transform((v) => v ?? {}),
  citas: z
    .array(z.object({
      campo: z.string(), texto: z.string(), timestamp: str,
      fuente: z.enum(["resumen", "accion", "transcripcion"]),
    }))
    .nullish()
    .transform((v) => v ?? []),
  confianza: z.record(z.string(), z.number()).nullish().transform((v) => v ?? {}),
  requiere_revision_humana: z.boolean().nullish().transform((v) => v ?? false),
  motivo_revision: str,
  faltantes: strList,
  aprendizajes: z
    .array(z.object({ tipo: z.enum(["BIEN", "MEJORAR"]), texto: z.string() }))
    .nullish()
    .transform((v) => (v ?? []).filter((a) => a.texto.trim())),
});

export type CallBrief = z.infer<typeof BriefZ>;
export const MONEY_FIELDS = ["venta_total", "cash_collected", "saldo_pendiente"] as const;

const ONE_LINE_MAX = 140;
export function clip(text: string, max = ONE_LINE_MAX) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** JSON text → validated brief, or null. Rule 2 of D1: an amount without its cita goes to null. */
export function parseBrief(raw: string): CallBrief | null {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const parsed = BriefZ.safeParse(data);
  if (!parsed.success) return null;
  const b = parsed.data;
  for (const field of MONEY_FIELDS) {
    if (b[field] === null) continue;
    const cited = b.citas.some((c) => c.campo === field && c.texto.trim());
    if (!cited || b[field]! < 0) {
      b[field] = null;
      if (!b.faltantes.includes(field)) b.faltantes.push(field);
    }
  }
  b.una_linea = b.una_linea ? clip(b.una_linea) : null;
  b.aprendizajes = [
    ...b.aprendizajes.filter((a) => a.tipo === "BIEN").slice(0, 2),
    ...b.aprendizajes.filter((a) => a.tipo === "MEJORAR").slice(0, 2),
  ].map((a) => ({ tipo: a.tipo, texto: clip(a.texto, 220) }));
  b.objeciones = [...new Set(b.objeciones.map((o) => clip(o, 80)))].slice(0, 6);
  return b;
}

export type Outcome = "CERRO" | "SEGUIMIENTO" | "PERDIDO" | "REAGENDAR";

/** estado_lead → suggested outcome. pendiente_pago and decidiendo stay in follow-up. */
export function outcomeFromBrief(b: Pick<CallBrief, "estado_lead" | "estado_agenda">): Outcome | null {
  if (b.estado_agenda === "INTERNA" || b.estado_agenda === "NO_COMERCIAL") return null;
  switch (b.estado_lead) {
    case "cerrado": return "CERRO";
    case "perdido": return "PERDIDO";
    case "reagendar": return "REAGENDAR";
    case "pendiente_pago":
    case "decidiendo": return "SEGUIMIENTO";
    default: return null;
  }
}

/** a sales call with a real person (not internal, not «no comercial») */
export function isSalesCall(b: Pick<CallBrief, "estado_agenda">) {
  return b.estado_agenda !== "INTERNA" && b.estado_agenda !== "NO_COMERCIAL";
}

// ---------- prompt ----------

export const BRIEF_SYSTEM_PROMPT = `Eres el extractor de CRM de un closer de ventas en español (Latinoamérica). Recibes de UNA llamada:
- METADATOS: título, FECHA_LLAMADA (YYYY-MM-DD, zona America/Bogota), invitados (nombre, email, externo sí/no).
- RESUMEN_FATHOM (Markdown, en inglés) y ACCIONES_FATHOM (en inglés, con marca HH:MM:SS y responsable).
- FRAGMENTOS_TRANSCRIPCION opcionales (en español, con [HH:MM:SS] Hablante: texto), normalmente los últimos 15 minutos y las ventanas donde se habla de dinero o de fechas.
- CATALOGO: ofertas con nombre exacto, alias y precios; modos de pago válidos; valores válidos de razon_no_cierre y etapa_perdida.
- LEAD_ACTUAL opcional: lo que el CRM ya sabe de esta persona.

Devuelve SOLO un JSON que cumpla el esquema. Reglas:
1. Nunca inventes. Si algo no se dijo, el campo va en null (o [] en listas) y lo agregas a "faltantes".
2. Montos: solo si se dijo una cifra explícita para ESTE cliente. Cada monto necesita una cita en "citas" (campo, texto, timestamp, fuente). Sin cita, el monto va en null. No conviertas monedas; pon la moneda solo si se dijo.
3. Si el resumen y la transcripción no coinciden, manda la transcripción. Si solo hay resumen, la confianza máxima de montos es 80.
4. estado_lead (uno solo):
   cerrado = pagó en la llamada o confirmó el pago.
   pendiente_pago = aceptó (producto y precio) pero el pago queda para después.
   decidiendo = le interesa y no decidió (lo va a pensar, consultar o comparar).
   reagendar = acordaron otra reunión, o no se pudo hacer.
   perdido = dijo que no, o no califica.
   Usa null si no hay base.
5. estado_agenda se mantiene con los valores actuales (SHOW, CIERRE VENTA, ACUERDO SIN PAGO, REPROGRAMA, NO SHOW, AGENDADO, INTERNA, NO_COMERCIAL). Si es INTERNA o NO_COMERCIAL: producto, montos, promesas y decisor van en null o vacíos.
6. decisor: quién toma la decisión de compra (el mismo cliente, pareja, socio, familiar u otro), si estuvo en la llamada, y la cita que lo muestra.
7. promesas: todo compromiso con su lado ("closer" o "cliente"), qué se prometió y para cuándo. Convierte las fechas relativas ("el viernes", "mañana a las 3") a YYYY-MM-DD o YYYY-MM-DDTHH:mm contando desde FECHA_LLAMADA, y deja el texto original en fecha_texto. Si no hay fecha, fecha va en null.
8. Compatibilidad: proximo_seguimiento = la promesa abierta más cercana; acuerdo_seguimiento = su texto; requiere_seguimiento = true si hay alguna promesa abierta.
9. producto: exactamente un nombre del CATALOGO, o null. Si se habló de algo fuera del catálogo, va en notas_crm.
10. confianza: de 0 a 100 por campo. No borres un dato por tener baja confianza: márcalo, y la app pedirá confirmarlo.
11. Escribe todos los textos en español neutro, cortos, sin comillas dobles dentro. Las citas de la transcripción van literales; si citas el resumen en inglés, tradúcelo y marca fuente "resumen".
12. una_linea: una frase en español de máximo 140 caracteres con qué pasó y qué sigue. Sin palabras técnicas.
13. objeciones: cada una como etiqueta corta en español (por ejemplo «Precio», «Lo tiene que consultar», «No es el momento»).
14. aprendizajes: hasta 2 de tipo BIEN y hasta 2 de tipo MEJORAR, dirigidos al closer de tú, concretos y basados solo en lo que pasó en esta llamada. Si no hay base, lista vacía.`;

export type BriefInput = {
  title: string;
  /** YYYY-MM-DD in Bogotá */
  callDay: string;
  invitees: Invitee[];
  summaryEn: string | null;
  actionItemsEn: string | null;
  transcriptText: string | null;
  offers: Array<{ name: string; currency: string }>;
};

const MONEY_OR_DATE =
  /\$|\d[\d.,]*\s*(?:mil|k|usd|cop|mxn|eur|d[oó]lares|pesos|euros)\b|\b(?:precio|pago|pagar|cuota|cuotas|transferencia|tarjeta|contado|inversi[oó]n|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|mañana|semana|mes|price|pay|payment|monday|tuesday|wednesday|thursday|friday|tomorrow|week)\b/i;

/** Last ~15 minutes (or last 12k chars) plus the money/date windows before it. */
export function transcriptExcerpt(text: string | null): string | null {
  if (!text?.trim()) return null;
  const lines = text.split("\n").filter((l) => l.trim());
  const secs = lines.map((l) => timestampSeconds(l.match(/^\[([\d:.]+)\]/)?.[1]));
  const last = secs.reduce<number | null>((m, s) => (s !== null && (m === null || s > m) ? s : m), null);
  let tailStart = lines.length;
  if (last !== null) {
    const from = last - TAIL_SEC;
    tailStart = lines.findIndex((_, i) => (secs[i] ?? -1) >= from);
    if (tailStart < 0) tailStart = lines.length;
  }
  // keep the tail within TAIL_CHARS (from the end)
  let size = 0;
  let start = lines.length;
  while (start > 0 && (start > tailStart || last === null) && size + lines[start - 1].length + 1 <= TAIL_CHARS) {
    size += lines[start - 1].length + 1;
    start -= 1;
  }
  const keep = new Set<number>();
  let windowSize = 0;
  for (let i = 0; i < start && windowSize < WINDOW_CHARS; i += 1) {
    if (!MONEY_OR_DATE.test(lines[i])) continue;
    for (const j of [i - 1, i, i + 1]) {
      if (j >= 0 && j < start && !keep.has(j)) {
        keep.add(j);
        windowSize += lines[j].length + 1;
      }
    }
  }
  const out: string[] = [];
  let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (prev >= 0 && i !== prev + 1) out.push("[…]");
    out.push(lines[i]);
    prev = i;
  }
  if (out.length && start < lines.length) out.push("[…]");
  if (start < lines.length) out.push(...lines.slice(start));
  return out.join("\n") || null;
}

export function buildBriefPrompt(input: BriefInput): string {
  const invitees = input.invitees.length
    ? input.invitees.map((i) => `- ${i.name ?? "(sin nombre)"} · ${i.email ?? "sin email"} · externo: sí`).join("\n")
    : "(no hay)";
  const catalog = input.offers.length
    ? input.offers.map((o) => `- ${o.name} (moneda ${o.currency})`).join("\n")
    : "(sin ofertas cargadas)";
  const excerpt = transcriptExcerpt(input.transcriptText);
  return [
    BRIEF_SYSTEM_PROMPT,
    "",
    "METADATOS",
    `Título: ${input.title}`,
    `FECHA_LLAMADA: ${input.callDay}`,
    "Invitados:",
    invitees,
    "",
    "RESUMEN_FATHOM",
    input.summaryEn?.trim() || "(no hay: Fathom no resumió esta llamada; usa solo la transcripción y anota en faltantes lo que no se sepa)",
    "",
    "ACCIONES_FATHOM",
    input.actionItemsEn?.trim() || "(no hay)",
    "",
    "FRAGMENTOS_TRANSCRIPCION",
    excerpt ?? "(no hay)",
    "",
    "CATALOGO",
    catalog,
  ].join("\n");
}

export type BriefResult =
  | { ok: true; brief: CallBrief; outcome: Outcome | null; oneLine: string }
  | { ok: false; reason: "NO_CONTENT" | "MODEL" | "INVALID" };

export async function runCallBrief(input: BriefInput, model: ModelCall | null): Promise<BriefResult> {
  if (!input.summaryEn?.trim() && !input.actionItemsEn?.trim() && !input.transcriptText?.trim()) {
    return { ok: false, reason: "NO_CONTENT" };
  }
  if (!model) return { ok: false, reason: "MODEL" };
  let raw: string;
  try {
    raw = await model(buildBriefPrompt(input), BRIEF_GEMINI_SCHEMA);
  } catch (error) {
    console.warn("[brief] model failed:", error instanceof Error ? error.message.slice(0, 160) : "unknown");
    return { ok: false, reason: "MODEL" };
  }
  const brief = parseBrief(raw);
  if (!brief) return { ok: false, reason: "INVALID" };
  if (!input.summaryEn?.trim() && !brief.faltantes.includes("resumen_fathom")) brief.faltantes.push("resumen_fathom");
  const oneLine = brief.una_linea ?? clip(brief.notas_crm ?? brief.acuerdo_seguimiento ?? input.title);
  return { ok: true, brief, outcome: outcomeFromBrief(brief), oneLine };
}

