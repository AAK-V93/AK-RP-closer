import { generateGeminiJson } from "@/lib/gemini";

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
};

export type LeadPlaybook = {
  icp: string;
  howLeadsTalk: string;
  neverDo: string[];
  typicalObjections: { quote: string; root: string }[];
  buyingTriggers: string[];
  phrases: string[];
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
    })),
  };
}

export function isPlaybookReady(playbook: LeadPlaybook) {
  return playbook.personas.length > 0 || playbook.typicalObjections.length > 0;
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

export async function extractLeadPlaybook(args: {
  productName: string;
  productDescription: string;
  transcripts: { title: string; text: string }[];
}) {
  const corpus = compactCorpus(args.transcripts);
  if (!corpus.trim()) {
    return emptyPlaybook();
  }

  const prompt = `Eres un director de roleplay de ventas. A partir de la OFERTA del closer y de TRANSCRIPCIONES REALES de sus llamadas, extrae cómo se comportan SUS leads (no un lead genérico).

OFERTA:
${args.productName}
${args.productDescription}

TRANSCRIPCIONES:
${corpus}

Devuelve SOLO JSON:
{
  "icp": "quién compra esto, 1-2 frases",
  "howLeadsTalk": "cómo hablan: ritmo, formalidad, si cortan, si dan rodeos, si preguntan precio pronto. 4-8 frases.",
  "neverDo": ["cosas que el bot NO debe hacer porque estos leads no lo hacen"],
  "typicalObjections": [{"quote":"cita o parafraseo fiel","root":"dinero|tiempo|pareja|confianza|timing|otro"}],
  "buyingTriggers": ["qué los mueve a comprar"],
  "phrases": ["frases típicas textuales de los leads, no del closer"],
  "personas": [
    {
      "name": "nombre o alias del lead real si aparece, si no un nombre coherente",
      "age": 35,
      "occupation": "",
      "location": "",
      "situation": "su caso concreto",
      "money": "capacidad / objeción de dinero observada",
      "decision": "quién decide",
      "objections": ["..."],
      "speechStyle": "cómo habla ESTE lead",
      "typicalLines": ["2-5 frases que diría"]
    }
  ]
}

Reglas:
- 4 a 8 personas distintas sacadas de las calls (no inventes ICP de otro nicho).
- typicalLines y phrases deben sonar a esas llamadas.
- No copies el estilo del closer. Solo el prospecto.
- Si una call es Impromptu, igual extrae el lead.`;

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
  return parsePlaybook(JSON.parse(cleaned));
}

export function compactPlaybookForPrompt(playbook: LeadPlaybook) {
  return {
    icp: playbook.icp,
    howLeadsTalk: playbook.howLeadsTalk.slice(0, 700),
    neverDo: playbook.neverDo.slice(0, 6),
    typicalObjections: playbook.typicalObjections.slice(0, 8),
    buyingTriggers: playbook.buyingTriggers.slice(0, 6),
    phrases: playbook.phrases.slice(0, 12),
  };
}
