import { readableTitle } from "@/lib/plain-labels";

/**
 * Ofertas → Transcripciones: each name or title once. Pasted calls with no name
 * («Pegado 1 oct» ×4) become one line: «4 transcripciones pegadas el 1 oct».
 */
export function transcriptListRows(rows: readonly { id: string; title: string }[], now = new Date()) {
  const groups = new Map<string, { id: string; label: string; count: number; pasted: string }>();
  for (const row of rows) {
    const label = readableTitle(row.title, now).trim() || "Transcripción sin título";
    const pasted = label.match(/^Pegad[oa]\s+(.+)$/i)?.[1]?.trim() || "";
    const key = label.toLocaleLowerCase("es");
    const prev = groups.get(key);
    if (prev) prev.count += 1;
    else groups.set(key, { id: row.id, label, count: 1, pasted });
  }
  return [...groups.values()].map((group) => {
    if (group.pasted) {
      return {
        id: group.id,
        label:
          group.count === 1
            ? `Transcripción pegada el ${group.pasted}`
            : `${group.count} transcripciones pegadas el ${group.pasted}`,
      };
    }
    return { id: group.id, label: group.count === 1 ? group.label : `${group.label} (${group.count})` };
  });
}

/**
 * Ofertas card: the description in whole sentences, never cut with «…».
 * `preview` is the first two sentences; `long` says a «Ver la descripción completa» is needed.
 */
export function offerDescriptionPreview(productName: string, description: string) {
  let full = String(description || "").replace(/[ \t]+/g, " ").trim();
  const name = String(productName || "").trim();
  if (name && full.toLowerCase().startsWith(name.toLowerCase()) && full.length > name.length + 20) {
    full = full.slice(name.length).replace(/^[\s:.\-–—]+/, "").trim();
  }
  const sentences = full.split(/(?<=[.!?])\s+/).filter(Boolean);
  const preview = sentences.slice(0, 2).join(" ");
  return { full, preview: preview || full, long: sentences.length > 2 };
}
