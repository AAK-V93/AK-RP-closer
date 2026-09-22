export type OfferSignal = {
  productName: string;
  aliases: string[];
  prices: number[];
};

export type AmountBand = {
  amount: number;
  offerName: string;
  count: number;
};

export type OfferResolution = {
  producto: string | null;
  confidence: number;
  ask: boolean;
  options: string[];
};

const REPEAT = 2;

export function offerSignals(
  offers: {
    productName: string;
    commercial: {
      aliases: string[];
      listPrice: number | null;
      altPrices: { amount: number | null }[];
    };
  }[],
): OfferSignal[] {
  return offers
    .map((offer) => ({
      productName: offer.productName.trim(),
      aliases: offer.commercial.aliases.map((item) => item.trim()).filter(Boolean),
      prices: [
        offer.commercial.listPrice,
        ...offer.commercial.altPrices.map((row) => row.amount),
      ].filter((amount): amount is number => amount != null && amount > 0),
    }))
    .filter((offer) => offer.productName);
}

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function mentioned(text: string, name: string) {
  const needle = fold(name).trim();
  if (needle.length < 4) return false;
  const hay = fold(text);
  if (needle.length <= 5) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(hay);
  }
  return hay.includes(needle);
}

export function offersNamedInText(offers: OfferSignal[], text: string) {
  const hits = offers.filter((offer) =>
    [offer.productName, ...offer.aliases].some((name) => mentioned(text, name)),
  );
  return hits.length === 1 ? hits[0] : null;
}

export function sameMoney(a: number, b: number) {
  const diff = Math.abs(a - b);
  return diff <= Math.max(50, Math.max(a, b) * 0.05);
}

export function offersAtAmount(offers: OfferSignal[], amount: number) {
  if (!amount || amount <= 0) return [];
  return offers.filter((offer) => offer.prices.some((price) => sameMoney(price, amount)));
}

export function amountBand(amount: number) {
  return Math.round(amount / 100) * 100;
}

export function amountBandsFromFeedback(
  rows: { valorExtraido: string; valorCorregido: string }[],
): AmountBand[] {
  const bands: AmountBand[] = [];
  for (const row of rows) {
    const match = /MONTO:\s*(\d+(?:\.\d+)?)/i.exec(row.valorExtraido || "");
    const offerName = row.valorCorregido.trim();
    if (!match || !offerName) continue;
    const amount = Number(match[1]);
    if (!amount) continue;
    const existing = bands.find(
      (band) => fold(band.offerName) === fold(offerName) && sameMoney(band.amount, amount),
    );
    if (existing) existing.count += 1;
    else bands.push({ amount: amountBand(amount), offerName, count: 1 });
  }
  return bands;
}

function learnedOffer(bands: AmountBand[], amount: number, allowed: string[]) {
  const hits = bands.filter(
    (band) =>
      band.count >= REPEAT &&
      sameMoney(band.amount, amount) &&
      (allowed.length === 0 ||
        allowed.some((name) => fold(name) === fold(band.offerName))),
  );
  const names = [...new Set(hits.map((band) => band.offerName))];
  return names.length === 1 ? names[0] : null;
}

export function resolveOfferAssignment(args: {
  offers: OfferSignal[];
  transcript?: string | null;
  producto?: string | null;
  amounts: number[];
  learned?: AmountBand[];
}): OfferResolution {
  const offers = args.offers;
  const names = offers.map((offer) => offer.productName);
  const none = { producto: null, confidence: 0, ask: false, options: [] as string[] };
  if (!offers.length) return none;

  const named =
    offersNamedInText(offers, args.transcript || "") ||
    offersNamedInText(offers, args.producto || "");
  if (named) {
    return { producto: named.productName, confidence: 95, ask: false, options: [] };
  }

  const amounts = args.amounts.filter((amount) => amount > 0);
  const learned = args.learned || [];
  const byAmount = new Map<string, OfferSignal>();
  for (const amount of amounts) {
    for (const offer of offersAtAmount(offers, amount)) {
      byAmount.set(fold(offer.productName), offer);
    }
  }
  const priceHits = [...byAmount.values()];
  if (priceHits.length === 1) {
    return { producto: priceHits[0].productName, confidence: 95, ask: false, options: [] };
  }

  for (const amount of amounts) {
    const pool = priceHits.length > 1 ? priceHits.map((offer) => offer.productName) : names;
    const learnedName = learnedOffer(learned, amount, priceHits.length > 1 ? pool : []);
    if (learnedName) {
      const canonical =
        offers.find((offer) => fold(offer.productName) === fold(learnedName))?.productName ||
        learnedName;
      return { producto: canonical, confidence: 90, ask: false, options: [] };
    }
  }

  const options = priceHits.length > 1 ? priceHits.map((offer) => offer.productName) : names;
  return { producto: null, confidence: 40, ask: true, options };
}

export function offerLearningHint(bands: AmountBand[]) {
  return bands
    .filter((band) => band.count >= REPEAT)
    .map(
      (band) =>
        `Montos cerca de ${band.amount} suelen ser la oferta "${band.offerName}". Asígnarla con confianza >= 90 si no hay otra señal más clara.`,
    )
    .join(" ");
}
