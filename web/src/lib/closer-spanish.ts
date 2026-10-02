const PHRASES: [RegExp, string][] = [
  [
    /acknowledge\s*\+\s*associate\s*\+\s*ask\s*back/gi,
    "Reconoce + Relaciona + Devuelve la pregunta",
  ],
  [
    /acknowledge\s*,\s*associate\s*,\s*ask\s*back/gi,
    "Reconoce, Relaciona, Devuelve la pregunta",
  ],
  [/paid media/gi, "Publicidad pagada"],
  [/\bdrills\b/gi, "ejercicios"],
  [/\bdrill\b/gi, "ejercicio"],
  [/\bdiscovery\b/gi, "descubrimiento"],
  [/\bpitch\b/gi, "presentación de la oferta"],
];

/** User-facing sales jargon. Internal ids stay in English. */
export function closerSpanish(text: string) {
  return PHRASES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}
