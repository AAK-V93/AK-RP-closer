const DANGLING = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "e",
  "el",
  "en",
  "la",
  "las",
  "le",
  "les",
  "lo",
  "los",
  "o",
  "para",
  "por",
  "que",
  "se",
  "sin",
  "su",
  "sus",
  "u",
  "un",
  "una",
  "y",
]);

function foldWord(word: string) {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/^[\s«"'(]+|[\s»"'),.;:!?]+$/g, "");
}

/** Drop a cut that would finish on «el», «de», «la» and the like. */
export function dropDanglingWords(value: string) {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  while (words.length > 2 && DANGLING.has(foldWord(words[words.length - 1] || ""))) {
    words.pop();
  }
  return words.join(" ").replace(/[.,;:]+$/g, "").trim();
}

/**
 * Shorten user-visible prose. Names stay whole at the call site.
 * A cut always ends with «…» and never on a dangling word.
 */
export function clipVisible(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean || clean.length <= max) return clean;
  const budget = Math.max(8, max - 1);
  let cut = clean.slice(0, budget);
  const space = cut.lastIndexOf(" ");
  if (space >= 8) cut = cut.slice(0, space);
  const body = dropDanglingWords(cut);
  return `${body || cut.trim()}…`;
}

/** The caller already dropped the rest of the sentence. */
export function ellipsisCut(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const body = dropDanglingWords(clean);
  return `${body || clean}…`;
}
