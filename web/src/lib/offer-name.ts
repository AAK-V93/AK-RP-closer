export function foldOffer(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** A price recap, not the program name. "Lista USD 11800 · Contado especial USD 10000". */
export function isPriceLabel(raw: string | null | undefined) {
  const text = String(raw || "").trim();
  if (!text) return false;
  const hasCurrency = /\b(usd|us\$|eur|pen|mxn|cop|clp|ars|\$)\b/i.test(text);
  const hasPriceWord = /\b(lista|contado|precio|ticket|cuotas?)\b/i.test(text);
  const hasAmount = /\d{3,}/.test(text);
  if (hasCurrency && hasAmount) return true;
  if (hasPriceWord && hasAmount) return true;
  return false;
}

/** Free text the chat once wrote into Producto, not a catalog offer. */
export function isInventedOfferLabel(raw: string | null | undefined) {
  const text = String(raw || "").trim();
  if (!text || isPriceLabel(text)) return false;
  if (text.length > 80) return true;
  if (text.split(/\s+/).length > 8) return true;
  if (/^(quedamos|qued[eé]|el\s+viernes|otro|otros|null)\b/i.test(text)) return true;
  return false;
}

export function nameHintsFromText(text: string) {
  const hints: string[] = [];
  const lines = String(text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
  for (const line of lines) {
    const head = line.split(/[|·]/)[0]?.trim() || "";
    const short = head.split(/[:.]/)[0]?.trim() || "";
    if (short.length >= 3 && short.length <= 60) hints.push(short);
  }
  const titled = String(text || "").match(/\p{Lu}[\p{Ll}]+(?:\s+\p{Lu}[\p{Ll}]+){1,4}/gu) || [];
  hints.push(...titled);
  return hints;
}

export type NamedOffer = {
  id?: string;
  productName: string;
  productDescription?: string;
  aliases?: string[];
};

export function catalogDisplayName(offer: NamedOffer, hints: string[] = []) {
  const stored = offer.productName.trim();
  if (stored && !isPriceLabel(stored) && !isInventedOfferLabel(stored)) return stored;

  // A sentence the chat saved is not a catalog offer, even if calls mention a real program.
  const pool = [
    ...(offer.aliases || []),
    ...(isInventedOfferLabel(stored) ? [] : hints),
    ...nameHintsFromText(isInventedOfferLabel(stored) ? "" : offer.productDescription || ""),
  ];
  const counts = new Map<string, { label: string; n: number }>();
  for (const raw of pool) {
    const label = raw.trim();
    if (!label || isPriceLabel(label) || isInventedOfferLabel(label)) continue;
    if (label.length > 60 || label.split(/\s+/).length > 6) continue;
    const key = foldOffer(label);
    if (!key) continue;
    const cur = counts.get(key) || { label, n: 0 };
    cur.n += 1;
    if (/[\u0300-\u036f]/.test(label.normalize("NFD")) || label !== cur.label) {
      if (label.normalize("NFD") !== label) cur.label = label;
    }
    counts.set(key, cur);
  }
  const ranked = [...counts.values()].sort(
    (a, b) => b.n - a.n || a.label.length - b.label.length,
  );
  return ranked[0]?.label || "";
}

export function offersWithDisplayNames(offers: NamedOffer[], hints: string[]) {
  return offers.flatMap((offer) => {
    const displayName = catalogDisplayName(offer, hints);
    if (!displayName) return [];
    return [{ ...offer, displayName }];
  });
}

/** Keep a real program name when a re-extract only found the price line. */
export function preferOfferName(current: string, extracted: string) {
  const next = extracted.trim();
  const prev = current.trim();
  if (!next) return prev;
  if ((isPriceLabel(next) || isInventedOfferLabel(next)) && prev && !isPriceLabel(prev)) {
    return prev;
  }
  return next;
}
