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

export function libraryRateLabel(kind: "enviados" | "cierres", rate: number) {
  const pct = Math.round((Number(rate) || 0) * 100);
  if (kind === "enviados") return `se envió ${pct}%`;
  return `cerró ${pct}%`;
}
