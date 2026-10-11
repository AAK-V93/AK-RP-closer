// «Results only cite figures present in the source snippet»: an extracted
// text that mentions a number not in the snippet is dropped, never shown.
function numbers(text: string) {
  return (text.match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(/[.,]$/, "").replace(",", "."));
}

export function figuresInSnippet(text: string, snippet: string) {
  const allowed = new Set(numbers(snippet));
  return numbers(text).every((n) => allowed.has(n));
}

/** The text if every figure in it appears in the snippet; otherwise null. */
export function guardFigures(text: string | null | undefined, snippet: string): string | null {
  const t = text?.trim();
  if (!t) return null;
  return figuresInSnippet(t, snippet) ? t : null;
}
