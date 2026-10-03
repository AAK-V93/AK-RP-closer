/**
 * Display-time glossary for closer-facing text. Stored rows stay as generated.
 * JSON keys and the phase enum discovery|pitch|close|other are not values here.
 */
export const PLAIN_SPANISH_RULE = `Escribe las frases que lee el closer en español claro, con concordancia.
Prohibido en esas frases: pitch, pitches, pitchear, discovery, drill, drills, Acknowledge, Associate, Ask Back, Paid Media, high-ticket, marco 3A, previa al pitch.
Usa en su lugar: presentación de la oferta, presentaciones de la oferta, antes de presentar la oferta, descubrimiento, ejercicio, ejercicios, Reconoce, Relaciona y Devuelve la pregunta, Publicidad pagada, alto valor.
No escribas «previa al pitch» ni «marco 3A».
Las claves JSON y los valores del enum discovery|pitch|close|other se quedan en inglés. Las frases no.`;

const ENUM_KEYS = new Set([
  "coverage",
  "intended",
  "phase",
  "id",
  "callSection",
  "section",
]);

const DENY_PLURAL = new Set(["los", "esos", "otros", "nosotros", "ellos", "mismos", "vos"]);
const DENY_SINGULAR = new Set([
  "de",
  "no",
  "lo",
  "el",
  "un",
  "su",
  "al",
  "ya",
  "yo",
  "eso",
  "esto",
  "todo",
  "como",
  "pero",
  "solo",
  "uno",
  "otro",
  "mismo",
]);

function matchCase(sample: string, replacement: string) {
  const first = sample[0];
  if (first && first !== first.toLowerCase() && first === first.toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function agreeEnding(word: string, from: string, to: string) {
  const tail = word.slice(-from.length);
  const next = tail === tail.toUpperCase() ? to.toUpperCase() : to;
  return word.slice(0, -from.length) + next;
}

function agreeAdjective(word: string, plural: boolean) {
  const lower = word.toLowerCase();
  if (plural) {
    if (DENY_PLURAL.has(lower) || !/os$/i.test(word)) return null;
    return agreeEnding(word, "os", "as");
  }
  if (DENY_SINGULAR.has(lower) || !/o$/i.test(word)) return null;
  return agreeEnding(word, "o", "a");
}

function replaceAaa(text: string) {
  return text.replace(
    /\backnowledge\b(\s*(?:\+|y|e|and|,)\s*)\bassociate\b(\s*(?:\+|y|e|and|,)\s*)\bask\s*back\b/gi,
    (match, left: string, right: string) => {
      const plus = left.includes("+") && right.includes("+");
      const phrase = plus
        ? "Reconoce + Relaciona + Devuelve la pregunta"
        : "Reconoce, Relaciona y Devuelve la pregunta";
      return matchCase(match, phrase);
    },
  );
}

function replacePitchPhrase(text: string, plural: boolean) {
  const word = plural ? "pitches" : "pitch";
  const noun = plural ? "presentaciones de la oferta" : "presentación de la oferta";
  const ending = plural ? "os" : "o";
  const pattern = new RegExp(`\\b${word}\\s+([\\p{L}]+${ending})\\b`, "giu");
  return text.replace(pattern, (match, adjective: string) => {
    const agreed = agreeAdjective(adjective, plural);
    if (!agreed) return match;
    return `${matchCase(match, noun)} ${agreed}`;
  });
}

function replaceWord(text: string, pattern: RegExp, replacement: string) {
  return text.replace(pattern, (match) => matchCase(match, replacement));
}

/** User-facing sales jargon. Internal ids stay in English. */
export function closerSpanish(text: string) {
  let value = replaceAaa(text);
  value = replaceWord(
    value,
    /\bmarco\s+3A\b/gi,
    "marco de Reconoce, Relaciona y Devuelve la pregunta",
  );
  value = replaceWord(
    value,
    /\bmodelo\s+3A\b/gi,
    "modelo Reconoce, Relaciona y Devuelve la pregunta",
  );
  value = replaceWord(value, /\bprevias?\s+al\s+pitch\b/gi, "antes de presentar la oferta");
  value = replaceWord(value, /\bprevios?\s+al\s+pitch\b/gi, "antes de presentar la oferta");
  value = replaceWord(value, /\bantes\s+del\s+pitch\b/gi, "antes de presentar la oferta");
  value = replaceWord(value, /\bantes\s+de\s+pitchear\b/gi, "antes de presentar la oferta");
  value = replaceWord(value, /\bpitcheando\b/gi, "presentando la oferta");
  value = replaceWord(value, /\bpitchearon\b/gi, "presentaron la oferta");
  value = replaceWord(value, /\bpitchear\b/gi, "presentar la oferta");
  value = replaceWord(value, /\bpitche(?:ó|o)\b/gi, "presentó la oferta");
  value = replaceWord(value, /\bpitchea\b/gi, "presenta la oferta");
  value = replacePitchPhrase(value, true);
  value = replacePitchPhrase(value, false);
  value = replaceWord(value, /\bpitches\b/gi, "presentaciones de la oferta");
  value = replaceWord(value, /\bpitch\b/gi, "presentación de la oferta");
  value = replaceWord(value, /\bdrills\b/gi, "ejercicios");
  value = replaceWord(value, /\bdrill\b/gi, "ejercicio");
  value = replaceWord(value, /\bdiscovery\b/gi, "descubrimiento");
  value = replaceWord(value, /\bpaid media\b/gi, "Publicidad pagada");
  value = replaceWord(value, /\bhigh[- ]ticket\b/gi, "alto valor");
  value = replaceWord(value, /\bask\s*back\b/gi, "Devuelve la pregunta");
  value = replaceWord(value, /\backnowledge\b/gi, "Reconoce");
  value = replaceWord(value, /\bassociate\b/gi, "Relaciona");
  return value;
}

/** Walk stored analysis at render time. Keys and phase enums stay put. */
export function closerSpanishDeep<T>(value: T, key?: string): T {
  if (typeof value === "string") {
    if (key && ENUM_KEYS.has(key)) return value;
    return closerSpanish(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => closerSpanishDeep(item)) as T;
  }
  if (!value || typeof value !== "object") return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(value)) {
    out[childKey] = closerSpanishDeep(child, childKey);
  }
  return out as T;
}
