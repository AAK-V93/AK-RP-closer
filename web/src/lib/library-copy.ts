import { countPhrase, plainStatus } from "@/lib/plain-labels";

export const LIBRARY_INTRO =
  "Guiones de seguimiento listos para usar. Los mejores suben según cuántas veces se usaron y si funcionaron.";

export const LIBRARY_SEARCH = "Buscar por nombre, quien lo publicó o el tema";

export const LIBRARY_PUBLISH_TITLE = "Publicar guiones";

export const LIBRARY_PUBLISH_HELP =
  "Escribe el mensaje con [Nombre] y [PROGRAMA]. Esas palabras se cambian por la persona y la oferta al enviarlo. También puedes subir los de una oferta desde";

export const LIBRARY_PUBLISHED = "Listo. El resto del equipo ya puede usar estos guiones.";

export const LIBRARY_INSTALLED = "Listo. Esos guiones se usarán en esa oferta.";

export const LIBRARY_EMPTY = "Todavía no hay guiones compartidos. Publica los primeros.";

export const LIBRARY_NEED_OFFER = "Crea una oferta para usar estos guiones.";

const KIND_LABELS: Record<string, string> = {
  RETOMAR: "Retomar contacto",
};

/** Screen name for a script category. The stored code stays RETOMAR. */
export function libraryKindLabel(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const named = KIND_LABELS[raw.toUpperCase()];
  if (named) return named;
  return plainStatus(raw);
}

export function librarySortLabel(key: "puntaje" | "estrellas" | "recientes") {
  if (key === "puntaje") return "Mejor resultado";
  if (key === "estrellas") return "Favoritos";
  return "Recientes";
}

export function usagePhrase(uses: number) {
  const count = Math.trunc(Number(uses) || 0);
  if (count <= 0) return "aún sin usar";
  return countPhrase(count, "uso", "usos");
}

export function libraryUsageLine(args: {
  publisher?: string | null;
  mine?: boolean;
  scripts?: number | null;
  uses?: number | null;
}) {
  const name = String(args.publisher || "")
    .replace(/^@+/, "")
    .trim();
  const who = args.mine ? "Publicado por ti" : `Publicado por ${name || "Biblioteca"}`;
  const scripts = countPhrase(Math.max(0, Math.trunc(Number(args.scripts) || 0)), "guion", "guiones");
  return `${who} · ${scripts} · ${usagePhrase(Number(args.uses) || 0)}`;
}

export function libraryScriptLine(args: {
  type?: string | null;
  canal?: string | null;
  puntaje?: number | null;
  uses?: number | null;
}) {
  const score = args.puntaje ? ` · resultado ${args.puntaje}` : "";
  return `${libraryKindLabel(args.type)} · ${libraryKindLabel(args.canal)}${score} · ${usagePhrase(Number(args.uses) || 0)}`;
}

export type LibrarySituation = { id: string; label: string };

type SituationSource = {
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  items?: { type?: string | null; recomendacion?: string | null }[] | null;
};

/** Closer situations. A chip appears only when some guion already says it. */
const SITUATION_HINTS: { id: string; label: string; pattern: RegExp }[] = [
  { id: "no-contesta", label: "No contesta", pattern: /no contest/i },
  { id: "lo-consulto", label: "Lo consulto", pattern: /\bconsult/i },
  { id: "desconfiado", label: "Desconfiado", pattern: /desconfiad/i },
  { id: "pago", label: "Pago", pattern: /\b(pago|cobro)\b/i },
  { id: "decision", label: "Decisión", pattern: /decisi/i },
  { id: "segunda", label: "Segunda reunión", pattern: /segunda reuni/i },
  { id: "retomar", label: "Retomar contacto", pattern: /\bretomar\b/i },
];

function situationHaystack(pack: SituationSource) {
  const bits = [pack.title, pack.description, ...(pack.tags || [])];
  for (const item of pack.items || []) {
    bits.push(item.type, libraryKindLabel(item.type), item.recomendacion);
  }
  return bits.filter(Boolean).join("\n");
}

/**
 * Filters for the situations that already exist in these guiones.
 * «Lo consulto» stays hidden until a guion actually mentions it.
 */
export function librarySituationOptions(packs: SituationSource[]): LibrarySituation[] {
  const rows = packs || [];
  const found = SITUATION_HINTS.filter((hint) =>
    rows.some((pack) => hint.pattern.test(situationHaystack(pack))),
  );
  const covered = new Set(found.map((hint) => hint.id));
  const extras: LibrarySituation[] = [];
  const seen = new Set<string>();
  for (const pack of rows) {
    for (const item of pack.items || []) {
      const type = String(item.type || "").trim();
      if (!type) continue;
      const id = `tipo:${type.toUpperCase()}`;
      if (seen.has(id)) continue;
      const label = libraryKindLabel(type);
      if (SITUATION_HINTS.some((hint) => hint.pattern.test(type) || hint.pattern.test(label))) continue;
      if (covered.has(id)) continue;
      seen.add(id);
      extras.push({ id, label });
    }
  }
  extras.sort((a, b) => a.label.localeCompare(b.label, "es"));
  return [...found, ...extras];
}

export function packMatchesSituation(pack: SituationSource, situationId: string) {
  const id = String(situationId || "").trim();
  if (!id) return true;
  if (id.startsWith("tipo:")) {
    const type = id.slice(5);
    return (pack.items || []).some((item) => String(item.type || "").trim().toUpperCase() === type);
  }
  const hint = SITUATION_HINTS.find((row) => row.id === id);
  if (!hint) return true;
  return hint.pattern.test(situationHaystack(pack));
}

export function libraryRateLabel(kind: "enviados" | "cierres", rate: number) {
  const pct = Math.round((Number(rate) || 0) * 100);
  if (kind === "enviados") return `se envió ${pct}%`;
  return `cerró ${pct}%`;
}
