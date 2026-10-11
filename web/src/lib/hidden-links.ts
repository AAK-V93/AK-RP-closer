// Links that exist in the design but whose screen arrives in a later PR
// (Arquitectura, PR 5: «hidden, not "Muy pronto"»). A link listed here is not
// rendered at all; when its screen lands, remove its entry. The cutover PR
// asserts this list is empty (see v2-ingesta.test.ts, «hidden links»).
export const HIDDEN_LINKS = {
  /** Metas › Esta semana: «Ver a quién escribirle» → follow-up list (Personas, PR 7) */
  "metas.semana.a-quien-escribir": { href: "/personas?tab=seguimiento", until: "PR 7" },
  /** Metas › Lo que más te acerca: each person › ficha (PR 7) */
  "metas.cerca.ficha": { href: "/personas/[id]", until: "PR 7" },
  /** Confirmar: › on each call → the person's ficha (PR 7) */
  "confirmar.ficha": { href: "/personas/[id]", until: "PR 7" },
  /** Metas › Lo que más te frena: «Practicarlo» (practice v2) */
  "metas.frena.practicar": { href: "/practicar", until: "Practicar v2" },
} as const;

export type HiddenLinkId = keyof typeof HIDDEN_LINKS;

const HIDDEN = new Set<string>(Object.keys(HIDDEN_LINKS));

/** false while the link's screen does not exist yet: the link is not rendered. */
export function showLink(id: HiddenLinkId | string): boolean {
  return !HIDDEN.has(id);
}
