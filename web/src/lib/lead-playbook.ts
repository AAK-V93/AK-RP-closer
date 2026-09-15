import { generateGeminiJson } from "@/lib/gemini";

export type TalkStyle = "rambler" | "scattered" | "terse" | "storyteller";

export type LeadType = {
  name: string;
  talkStyle: TalkStyle;
  commonSituation: string;
  commonPhrases: string[];
  noiseTopics: string[];
  heldRelevant: string[];
  howTheyExpress: string;
};

export type LeadPersona = {
  name: string;
  age: number;
  occupation: string;
  location: string;
  situation: string;
  money: string;
  decision: string;
  objections: string[];
  speechStyle: string;
  typicalLines: string[];
  typeName: string;
};

export type LeadPlaybook = {
  icp: string;
  howLeadsTalk: string;
  neverDo: string[];
  typicalObjections: { quote: string; root: string }[];
  buyingTriggers: string[];
  phrases: string[];
  sampleReplies: string[];
  leadTypes: LeadType[];
  personas: LeadPersona[];
};

export function emptyPlaybook(): LeadPlaybook {
  return {
    icp: "",
    howLeadsTalk: "",
    neverDo: [],
    typicalObjections: [],
    buyingTriggers: [],
    phrases: [],
    sampleReplies: [],
    leadTypes: [],
    personas: [],
  };
}

export function parsePlaybook(raw: unknown): LeadPlaybook {
  const value = (raw || {}) as Partial<LeadPlaybook>;
  const personas = Array.isArray(value.personas) ? value.personas : [];
  return {
    icp: String(value.icp || ""),
    howLeadsTalk: String(value.howLeadsTalk || ""),
    neverDo: Array.isArray(value.neverDo) ? value.neverDo.map(String) : [],
    typicalObjections: Array.isArray(value.typicalObjections)
      ? value.typicalObjections.map((item) => ({
          quote: String(item?.quote || ""),
          root: String(item?.root || ""),
        }))
      : [],
    buyingTriggers: Array.isArray(value.buyingTriggers)
      ? value.buyingTriggers.map(String)
      : [],
    phrases: Array.isArray(value.phrases) ? value.phrases.map(String) : [],
    sampleReplies: Array.isArray(value.sampleReplies)
      ? value.sampleReplies.map(String).slice(0, 10)
      : [],
    leadTypes: parseLeadTypes(value.leadTypes),
    personas: personas.slice(0, 8).map((persona) => ({
      name: String(persona?.name || "Lead"),
      age: Number(persona?.age) || 35,
      occupation: String(persona?.occupation || ""),
      location: String(persona?.location || ""),
      situation: String(persona?.situation || ""),
      money: String(persona?.money || ""),
      decision: String(persona?.decision || ""),
      objections: Array.isArray(persona?.objections)
        ? persona.objections.map(String)
        : [],
      speechStyle: String(persona?.speechStyle || ""),
      typicalLines: Array.isArray(persona?.typicalLines)
        ? persona.typicalLines.map(String).slice(0, 6)
        : [],
      typeName: String(
        (persona as { typeName?: string }).typeName || "",
      ),
    })),
  };
}

export function isPlaybookReady(playbook: LeadPlaybook) {
  return (
    playbook.personas.length > 0 ||
    playbook.typicalObjections.length > 0 ||
    playbook.leadTypes.length > 0
  );
}

function parseTalkStyle(raw: unknown): TalkStyle {
  const value = String(raw || "").toLowerCase();
  if (value.includes("scatter") || value.includes("salta") || value.includes(" dispers")) {
    return "scattered";
  }
  if (value.includes("terse") || value.includes("corto") || value.includes("seco")) {
    return "terse";
  }
  if (value.includes("stor") || value.includes("anecd") || value.includes("historia")) {
    return "storyteller";
  }
  return "rambler";
}

function parseLeadTypes(raw: unknown): LeadType[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 6).map((item) => {
    const row = (item || {}) as Partial<LeadType> & Record<string, unknown>;
    return {
      name: String(row.name || "Tipo de lead").slice(0, 80),
      talkStyle: parseTalkStyle(row.talkStyle),
      commonSituation: String(row.commonSituation || "").slice(0, 280),
      commonPhrases: Array.isArray(row.commonPhrases)
        ? row.commonPhrases.map(String).slice(0, 8)
        : [],
      noiseTopics: Array.isArray(row.noiseTopics)
        ? row.noiseTopics.map(String).slice(0, 8)
        : [],
      heldRelevant: Array.isArray(row.heldRelevant)
        ? row.heldRelevant.map(String).slice(0, 8)
        : ["dinero real", "quién decide", "dolor de fondo"],
      howTheyExpress: String(row.howTheyExpress || "").slice(0, 280),
    };
  });
}

function uniqueStrings(items: string[], cap: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= cap) break;
  }
  return out;
}

function uniqueObjections(
  items: { quote: string; root: string }[],
  cap: number,
) {
  const seen = new Set<string>();
  const out: { quote: string; root: string }[] = [];
  for (const item of items) {
    const quote = String(item?.quote || "").trim();
    if (!quote) continue;
    const key = quote.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ quote, root: String(item?.root || "otro") });
    if (out.length >= cap) break;
  }
  return out;
}

function mergeByName<T extends { name: string }>(
  base: T[],
  incoming: T[],
  mergeOne: (prev: T, next: T) => T,
  cap: number,
) {
  const map = new Map<string, T>();
  for (const item of base) {
    const key = item.name.trim().toLowerCase();
    if (!key) continue;
    map.set(key, item);
  }
  for (const item of incoming) {
    const key = item.name.trim().toLowerCase();
    if (!key) continue;
    const prev = map.get(key);
    map.set(key, prev ? mergeOne(prev, item) : item);
  }
  return [...map.values()].slice(0, cap);
}

/** Une un extracto nuevo sobre el playbook que ya funciona. No pisa ICP ni tipos buenos. */
export function mergePlaybooks(
  base: LeadPlaybook,
  incoming: LeadPlaybook,
): LeadPlaybook {
  const keepNarrative = (current: string, next: string) =>
    current.trim().length >= 20 ? current : next.trim() || current;

  return {
    icp: keepNarrative(base.icp, incoming.icp),
    howLeadsTalk: keepNarrative(base.howLeadsTalk, incoming.howLeadsTalk),
    neverDo: uniqueStrings([...base.neverDo, ...incoming.neverDo], 12),
    typicalObjections: uniqueObjections(
      [...base.typicalObjections, ...incoming.typicalObjections],
      16,
    ),
    buyingTriggers: uniqueStrings(
      [...base.buyingTriggers, ...incoming.buyingTriggers],
      10,
    ),
    phrases: uniqueStrings([...base.phrases, ...incoming.phrases], 24),
    sampleReplies: uniqueStrings(
      [...base.sampleReplies, ...incoming.sampleReplies],
      10,
    ),
    leadTypes: mergeByName(
      base.leadTypes,
      incoming.leadTypes,
      (prev, next) => ({
        ...prev,
        commonSituation: prev.commonSituation || next.commonSituation,
        howTheyExpress: prev.howTheyExpress || next.howTheyExpress,
        commonPhrases: uniqueStrings(
          [...prev.commonPhrases, ...next.commonPhrases],
          8,
        ),
        noiseTopics: uniqueStrings(
          [...prev.noiseTopics, ...next.noiseTopics],
          8,
        ),
        heldRelevant: uniqueStrings(
          [...prev.heldRelevant, ...next.heldRelevant],
          8,
        ),
      }),
      6,
    ),
    personas: mergeByName(
      base.personas,
      incoming.personas,
      (prev, next) => ({
        ...prev,
        occupation: prev.occupation || next.occupation,
        location: prev.location || next.location,
        situation: prev.situation || next.situation,
        money: prev.money || next.money,
        decision: prev.decision || next.decision,
        speechStyle: prev.speechStyle || next.speechStyle,
        typeName: prev.typeName || next.typeName,
        objections: uniqueStrings([...prev.objections, ...next.objections], 8),
        typicalLines: uniqueStrings(
          [...prev.typicalLines, ...next.typicalLines],
          6,
        ),
      }),
      8,
    ),
  };
}

function compactCorpus(items: { title: string; text: string }[], limit = 18) {
  return items
    .filter((item) => item.text.trim().length > 80)
    .slice(0, limit)
    .map((item, index) => {
      return `# Call ${index + 1}: ${item.title}\n${item.text.slice(0, 2800)}`;
    })
    .join("\n\n---\n\n")
    .slice(0, 55_000);
}

const PLAYBOOK_JSON_SHAPE = `{
  "icp": "quién compra esto, 1-2 frases",
  "howLeadsTalk": "cómo hablan en general. 4-8 frases.",
  "neverDo": ["cosas que el bot NO debe hacer porque estos leads no lo hacen"],
  "typicalObjections": [{"quote":"cita o parafraseo fiel","root":"dinero|tiempo|pareja|confianza|timing|otro"}],
  "buyingTriggers": ["qué los mueve a comprar"],
  "phrases": ["frases típicas textuales compartidas por varios leads"],
  "sampleReplies": ["respuestas reales, como hablan, no párrafos de ficha"],
  "leadTypes": [
    {
      "name": "apodo del tipo (ej: empresario familiar que compara)",
      "talkStyle": "rambler|scattered|terse|storyteller",
      "commonSituation": "la situación que comparte este tipo",
      "commonPhrases": ["frases de ESTE tipo"],
      "noiseTopics": ["de qué hablan que NO es lo que el closer necesita (familia, anécdotas, quejas laterales)"],
      "heldRelevant": ["lo útil que se guardan: dinero real, quién decide, dolor de fondo, urgencia"],
      "howTheyExpress": "cómo dicen lo mismo que los demás tipos, con su color"
    }
  ],
  "personas": [
    {
      "name": "nombre o alias si aparece",
      "age": 35,
      "occupation": "",
      "location": "",
      "situation": "su caso concreto",
      "money": "capacidad / objeción de dinero observada",
      "decision": "quién decide",
      "objections": ["..."],
      "speechStyle": "cómo habla ESTE lead",
      "typicalLines": ["2-5 frases que diría"],
      "typeName": "el leadType.name al que pertenece"
    }
  ]
}`;

export async function extractLeadPlaybook(args: {
  productName: string;
  productDescription: string;
  transcripts: { title: string; text: string }[];
  existing?: LeadPlaybook | null;
}) {
  const existing = args.existing ? parsePlaybook(args.existing) : emptyPlaybook();
  const incremental = isPlaybookReady(existing);
  const corpus = compactCorpus(args.transcripts, incremental ? 8 : 18);
  if (!corpus.trim()) {
    return existing;
  }

  const prompt = incremental
    ? `Eres un director de roleplay de ventas. Ya tenemos un PLAYBOOK que funciona. Extrae SOLO lo NUEVO de estas transcripciones. No reescribas tipos ni personas existentes: si un tipo ya está, deja name igual y añade frases/objeciones nuevas. Si no hay nada nuevo, devuelve arrays vacíos y deja icp/howLeadsTalk vacíos.

OFERTA:
${args.productName}
${args.productDescription}

PLAYBOOK ACTUAL (no lo pises):
${JSON.stringify(compactPlaybookForPrompt(existing))}

TRANSCRIPCIONES (las más recientes):
${corpus}

Devuelve SOLO JSON con la misma forma. Arrays vacíos si no hay alta. Nombres de tipos/personas existentes deben coincidir para poder fusionar.
${PLAYBOOK_JSON_SHAPE}`
    : `Eres un director de roleplay de ventas. A partir de la OFERTA del closer y de TRANSCRIPCIONES REALES de sus llamadas, extrae cómo se comportan SUS leads (no un lead genérico).

OFERTA:
${args.productName}
${args.productDescription}

TRANSCRIPCIONES:
${corpus}

Devuelve SOLO JSON:
${PLAYBOOK_JSON_SHAPE}

Reglas:
- 2 a 5 leadTypes. Cada oferta tiene tipos, no 20 clones. Lo común es la situación y las frases; lo que cambia es cómo lo dicen y cuánto de lo RELEVANTE se guardan.
- talkStyle: rambler (se va por las ramas), scattered (salta de tema), terse (corto), storyteller (anécdotas).
- noiseTopics es obligatorio en rambler/scattered/storyteller: de eso SÍ hablan aunque no les pregunten.
- 4 a 8 personas, cada una atada a un tipo.
- No copies el estilo del closer. Si una call es Impromptu, igual extrae el lead.`;

  const text = await generateGeminiJson(prompt, 0.2, 4096, {
    timeoutMs: 90_000,
    models: ["gemini-flash-latest", "gemini-flash-lite-latest"],
  });
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```$/u, "")
    .trim();
  const extracted = parsePlaybook(JSON.parse(cleaned));
  return incremental ? mergePlaybooks(existing, extracted) : extracted;
}

export function compactPlaybookForPrompt(playbook: LeadPlaybook) {
  return {
    icp: playbook.icp,
    howLeadsTalk: playbook.howLeadsTalk.slice(0, 700),
    neverDo: playbook.neverDo.slice(0, 6),
    typicalObjections: playbook.typicalObjections.slice(0, 8),
    buyingTriggers: playbook.buyingTriggers.slice(0, 6),
    phrases: playbook.phrases.slice(0, 12),
    sampleReplies: (playbook.sampleReplies || []).slice(0, 8),
    leadTypes: playbook.leadTypes.slice(0, 5),
  };
}

export function typesFromPlaybook(playbook: LeadPlaybook): LeadType[] {
  if (playbook.leadTypes.length) return playbook.leadTypes;
  const talk = playbook.howLeadsTalk || "";
  const talkStyle = parseTalkStyle(talk);
  if (!playbook.personas.length && !playbook.typicalObjections.length) return [];
  return [
    {
      name: playbook.icp || "Lead típico de esta oferta",
      talkStyle,
      commonSituation: playbook.icp || playbook.personas[0]?.situation || "",
      commonPhrases: playbook.phrases.slice(0, 6),
      noiseTopics:
        talkStyle === "terse"
          ? []
          : ["anécdotas del negocio", "quejas laterales", "familia o equipo"],
      heldRelevant: ["dinero real", "quién decide", "dolor de fondo", "urgencia"],
      howTheyExpress: talk.slice(0, 220),
    },
  ];
}
