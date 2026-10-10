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
