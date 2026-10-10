/**
 * The coach builds exercises from the closer's real offers only.
 * Never a made-up offer or niche (an earlier exercise was about a software agency
 * that does not exist in this account).
 */
export type CoachOffer = { productName: string; productDescription?: string | null; pitchSummary?: string | null };

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut).trim();
}

export function coachOffersBlock(offers: readonly CoachOffer[]) {
  const real = offers.filter((offer) => String(offer.productName || "").trim());
  if (!real.length) {
    return [
      "# OFERTAS REALES DEL CLOSER",
      "No hay ofertas guardadas.",
      "REGLA: no inventes una oferta ni un tipo de negocio para el ejercicio. Pide que añada su oferta en Ofertas, o usa una llamada real de la evidencia.",
    ].join("\n");
  }
  const lines = real.map((offer) => {
    const name = String(offer.productName).trim();
    const what = clip(String(offer.productDescription || ""), 500);
    const pitch = clip(String(offer.pitchSummary || ""), 240);
    return `- ${name}${what ? `: ${what}` : ""}${pitch ? ` (cómo se presenta: ${pitch})` : ""}`;
  });
  return [
    "# OFERTAS REALES DEL CLOSER",
    ...lines,
    `REGLA: cada ejercicio usa una de estas ofertas por su nombre (${real
      .map((offer) => `«${String(offer.productName).trim()}»`)
      .join(", ")}) y un prospecto que podría comprarla. Nunca inventes otra oferta, otro producto ni otro tipo de negocio (por ejemplo, una agencia de software). Las duraciones, en español: «1 h 35 min», «20 min».`,
  ].join("\n");
}

const INVENTED_CONTEXT =
  /\b(agencias?|software|saas|publicidad pagada|paid media|b2b|done for you|dfy)\b|\$\s?\d[\d.,]*\s*(al|por) mes/i;
const OLD_NICHE = /^b2b-agencies-dfy$/i;

function fold(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * A coach message whose exercise is about a business the closer does not sell
 * (the Sept. 14 «agencia de Publicidad pagada / software B2B / $3,000 al mes» one):
 * it names an invented context and none of the closer's real offers.
 */
export function isInventedExercise(text: string, offers: readonly CoachOffer[]) {
  const value = String(text || "");
  if (!INVENTED_CONTEXT.test(value)) return false;
  const folded = fold(value);
  const offerHit = offers.some((offer) => {
    const name = fold(String(offer.productName || "").trim());
    return name.length >= 3 && folded.includes(name);
  });
  if (offerHit) return false;
  // The closer's own offer may itself be about agencies / software: then it's not invented.
  const offerText = fold(offers.map((offer) => `${offer.productName} ${offer.productDescription || ""}`).join(" "));
  const hits = value.match(new RegExp(INVENTED_CONTEXT.source, "gi")) || [];
  return hits.some((hit) => !offerText.includes(fold(hit)));
}

/** Notes sent to the model: the old default niche («b2b-agencies-dfy») is not the closer's offer. */
export function notesForPrompt<T extends { niche?: string }>(notes: T): T {
  return OLD_NICHE.test(String(notes.niche || "")) ? { ...notes, niche: "" } : notes;
}

export const STALE_EXERCISE_NOTE = "[Ejercicio anterior sobre un negocio que no es del closer: no lo continúes.]";

/** What the coach panel says instead of an invented exercise. */
export function staleExerciseCopy(offers: readonly CoachOffer[]) {
  const names = offers.map((offer) => String(offer.productName || "").trim()).filter(Boolean);
  if (!names.length) {
    return {
      text: "Este ejercicio era de antes y no usaba una oferta tuya. Añade tu oferta en Ofertas y el coach arma los ejercicios con ella.",
      ask: "",
    };
  }
  return {
    text: "Este ejercicio era de antes y no usaba tu oferta.",
    ask: `Dame un ejercicio con mi oferta ${names[0]}.`,
  };
}
