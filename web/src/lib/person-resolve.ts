import { normalizePersonName } from "@/lib/lead-match";

/**
 * Who a chat message or a tap is about. A leadId wins. Then the whole name
 * written in the message, then two or more of its words, then a first name
 * that only one person has. Never the last word alone: «Gina … Vargas» is
 * Gina, not «vargas». Two people that fit stay a question.
 */
export type ResolvablePerson = { id: string; name: string };

export type PersonResolution<T extends ResolvablePerson> =
  | { kind: "one"; person: T; via: "id" | "name" | "context" }
  | { kind: "ambiguous"; options: T[] }
  | { kind: "unknown"; spoken: string }
  | { kind: "none" };

const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "do", "van", "von"]);

/** Words that are never a first name in a question. */
const NOT_NAMES = new Set([
  "que", "quien", "quienes", "como", "cuando", "cuanto", "cuantos", "cuantas", "donde", "cual", "cuales",
  "hoy", "manana", "ayer", "semana", "mes", "seguimiento", "seguimientos", "llamada", "llamadas", "oferta",
  "objecion", "pago", "pagos", "ultima", "ultimo", "vez", "hablamos", "quede", "quedamos", "puso", "tiene",
  "todos", "todas", "esto", "eso", "esa", "ese", "ella", "el", "ellos", "con", "para", "por", "sin", "una", "uno",
  "mensaje", "telefono", "numero", "dijo", "sobre", "hay", "tengo", "toca", "tocan", "debe", "pago", "pagó",
  "sin nombre", "nombre",
]);

function words(value: string) {
  return normalizePersonName(value)
    .split(" ")
    .filter((part) => part.length > 1 && !PARTICLES.has(part));
}

function containsPhrase(hay: string, needle: string) {
  if (!needle) return false;
  return ` ${hay} `.includes(` ${needle} `);
}

/** «¿En qué quedé con Juan Vargas?» → «Juan Vargas». Only for the «no lo encontré» reply. */
export function spokenName(text: string) {
  const match = String(text || "").match(
    /\b(?:con|de|a|sobre|al)\s+((?:\p{Lu}[\p{L}'’-]+)(?:\s+(?:(?:de|del|la|y)\s+)?\p{Lu}[\p{L}'’-]+){0,4})/u,
  );
  return match ? match[1].trim() : "";
}

export function resolvePerson<T extends ResolvablePerson>(
  text: string,
  people: readonly T[],
  opts: { leadId?: string | null; contextId?: string | null; useContext?: boolean } = {},
): PersonResolution<T> {
  if (opts.leadId) {
    const byId = people.find((person) => person.id === opts.leadId);
    if (byId) return { kind: "one", person: byId, via: "id" };
  }
  const hay = normalizePersonName(text);
  const hayWords = new Set(words(text));
  const named = people.filter((person) => normalizePersonName(person.name) && !NOT_NAMES.has(normalizePersonName(person.name)));

  // 1. The whole name, as written. The longest wins («Carlos Ramírez» over «Carlos»).
  const full = named
    .map((person) => ({ person, key: normalizePersonName(person.name) }))
    .filter((row) => row.key.length >= 3 && containsPhrase(hay, row.key));
  if (full.length) {
    const longest = Math.max(...full.map((row) => row.key.length));
    const top = full.filter((row) => row.key.length === longest);
    const sameKey = new Set(top.map((row) => row.key));
    if (top.length === 1) return { kind: "one", person: top[0].person, via: "name" };
    if (sameKey.size >= 1) return { kind: "ambiguous", options: top.map((row) => row.person) };
  }

  // 2. Two or more words of the same person, including the first one.
  const partial = named
    .map((person) => {
      const parts = words(person.name);
      const hits = parts.filter((part) => part.length >= 3 && hayWords.has(part));
      return { person, hits: hits.length, first: hayWords.has(parts[0] || "") };
    })
    .filter((row) => row.hits >= 2 && row.first);
  if (partial.length) {
    const best = Math.max(...partial.map((row) => row.hits));
    const top = partial.filter((row) => row.hits === best);
    if (top.length === 1) return { kind: "one", person: top[0].person, via: "name" };
    return { kind: "ambiguous", options: top.map((row) => row.person) };
  }

  // 3. A first name. One person with it: that one. More: ask which.
  const firstHits = named.filter((person) => {
    const first = words(person.name)[0] || "";
    return first.length >= 3 && !NOT_NAMES.has(first) && hayWords.has(first);
  });
  if (firstHits.length) {
    // «Carlos Quito» written with a surname we don't have is not every Carlos.
    const spoken = spokenName(text);
    const spokenWords = words(spoken);
    if (spokenWords.length >= 2) {
      const fits = firstHits.filter((person) => spokenWords.every((part) => words(person.name).includes(part)));
      if (fits.length === 1) return { kind: "one", person: fits[0], via: "name" };
      if (!fits.length) return { kind: "unknown", spoken };
    }
    if (firstHits.length === 1) return { kind: "one", person: firstHits[0], via: "name" };
    return { kind: "ambiguous", options: firstHits };
  }

  const spoken = spokenName(text);
  if (spoken && !NOT_NAMES.has(normalizePersonName(spoken))) return { kind: "unknown", spoken };

  if (opts.useContext && opts.contextId) {
    const context = people.find((person) => person.id === opts.contextId);
    if (context) return { kind: "one", person: context, via: "context" };
  }
  return { kind: "none" };
}

/** «Hay dos Carlos: Carlos Ramírez y Carlos Quito. ¿Cuál?» */
export function whichOneQuestion(options: readonly ResolvablePerson[]) {
  const names = [...new Set(options.map((person) => person.name.trim()))];
  if (names.length < 2) return `¿Te refieres a ${names[0] || "esa persona"}?`;
  const listed = names.length === 2 ? `${names[0]} y ${names[1]}` : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  const head = words(names[0])[0] || "";
  const shared = head && names.every((name) => words(name)[0] === head);
  const count = names.length === 2 ? "dos" : String(names.length);
  const label = shared ? names[0].trim().split(/\s+/)[0] : "personas";
  return shared ? `Hay ${count} ${label}: ${listed}. ¿Cuál?` : `Puede ser ${listed}. ¿Cuál?`;
}
