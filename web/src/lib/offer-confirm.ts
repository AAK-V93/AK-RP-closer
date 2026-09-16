import {
  commissionSummary,
  emptyCommercial,
  parseCommissionFromText,
  type ExtractedOffer,
  type OfferCommercial,
} from "@/lib/offer-commercial";

export const OFFER_CONFIRM_BLOCKS = [
  { id: "name", title: "Nombre" },
  { id: "icp", title: "ICP deducido" },
  { id: "prices", title: "Precios" },
  { id: "payments", title: "Pagos y plazos" },
  { id: "bonuses", title: "Bonos" },
  { id: "commission", title: "Comisión por tramos" },
  { id: "paymentDetails", title: "Datos de pago" },
] as const;

export type OfferConfirmBlockId = (typeof OFFER_CONFIRM_BLOCKS)[number]["id"];

export type OfferConfirmBlock = {
  id: OfferConfirmBlockId;
  title: string;
  summary: string;
  empty: boolean;
  hint?: string;
};

function money(currency: string, amount: number | null) {
  if (amount == null) return "";
  return `${currency} ${amount}`;
}

function priceLines(commercial: OfferCommercial) {
  const lines: string[] = [];
  if (commercial.listPrice) {
    lines.push(`Lista: ${money(commercial.currency, commercial.listPrice)}`);
  }
  for (const row of commercial.altPrices) {
    if (!row.label && row.amount == null) continue;
    lines.push(
      [row.label || "precio", row.amount != null ? money(commercial.currency, row.amount) : ""]
        .filter(Boolean)
        .join(": "),
    );
  }
  return lines;
}

function paymentLines(commercial: OfferCommercial) {
  const lines: string[] = [];
  for (const row of commercial.paymentModes) {
    lines.push([row.name, row.details].filter(Boolean).join(" — "));
  }
  for (const row of commercial.deadlines) {
    const days = row.days ? `${row.days} días` : "";
    const applies = row.appliesTo ? `(${row.appliesTo})` : "";
    lines.push(["Plazo", row.name, days, applies].filter(Boolean).join(" "));
  }
  return lines;
}

function bonusLines(commercial: OfferCommercial) {
  return commercial.bonuses.map((row) =>
    [row.name, row.condition].filter(Boolean).join(" — "),
  );
}

export function offerConfirmBlocks(offer: ExtractedOffer): OfferConfirmBlock[] {
  const { commercial } = offer;
  const prices = priceLines(commercial);
  const payments = paymentLines(commercial);
  const bonuses = bonusLines(commercial);
  const commission = commissionSummary(commercial.commission);
  const icp = (offer.icp || "").trim();
  const paymentDetails = commercial.paymentDetails.trim();

  return OFFER_CONFIRM_BLOCKS.map((block) => {
    if (block.id === "name") {
      const summary = offer.productName.trim();
      return {
        ...block,
        summary: summary || "Sin nombre",
        empty: !summary,
      };
    }
    if (block.id === "icp") {
      return {
        ...block,
        summary: icp || "No pude deducir el ICP del documento.",
        empty: !icp,
        hint: icp ? undefined : "Corregir si sabes a quién le vendes.",
      };
    }
    if (block.id === "prices") {
      return {
        ...block,
        summary: prices.join(" · ") || "No encontré precios.",
        empty: !prices.length,
      };
    }
    if (block.id === "payments") {
      return {
        ...block,
        summary: payments.join(" · ") || "No encontré formas de pago ni plazos.",
        empty: !payments.length,
      };
    }
    if (block.id === "bonuses") {
      return {
        ...block,
        summary: bonuses.join(" · ") || "Sin bonos en el documento.",
        empty: !bonuses.length,
      };
    }
    if (block.id === "commission") {
      return {
        ...block,
        summary: commission || "No encontré comisión. No asumo un %.",
        empty: !commission,
        hint: commission
          ? undefined
          : "Corregir si te pagan comisión. Sí = correcto, no estaba en el texto.",
      };
    }
    return {
      ...block,
      summary: paymentDetails || "Sin datos de pago en el documento.",
      empty: !paymentDetails,
    };
  });
}

export function blockDraft(offer: ExtractedOffer, id: OfferConfirmBlockId): string {
  const { commercial } = offer;
  if (id === "name") return offer.productName;
  if (id === "icp") return offer.icp || "";
  if (id === "prices") return priceLines(commercial).join("\n");
  if (id === "payments") return paymentLines(commercial).join("\n");
  if (id === "bonuses") return bonusLines(commercial).join("\n");
  if (id === "commission") {
    return commercial.commission?.notes || commissionSummary(commercial.commission);
  }
  return commercial.paymentDetails;
}

function parseAmount(raw: string) {
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parsePriceBlock(text: string, commercial: OfferCommercial): OfferCommercial {
  const lines = text
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean);
  if (!lines.length) {
    return { ...commercial, listPrice: null, altPrices: [] };
  }
  let listPrice = commercial.listPrice;
  let currency = commercial.currency;
  const altPrices: { label: string; amount: number | null }[] = [];
  for (const line of lines) {
    const currencyHit = line.match(/\b(USD|EUR|PEN|MXN|COP|CLP|ARS)\b/i);
    if (currencyHit) currency = currencyHit[1].toUpperCase();
    const amount = parseAmount(line);
    if (/lista/i.test(line) && amount != null) {
      listPrice = amount;
      continue;
    }
    if (amount != null && altPrices.length === 0 && listPrice == null) {
      listPrice = amount;
      continue;
    }
    const label = line.replace(/[:\-–].*$/, "").replace(/\b(USD|EUR|PEN|MXN|COP|CLP|ARS|\d[\d.\s,]*)\b/gi, "").trim();
    altPrices.push({ label: label || line, amount });
  }
  return { ...commercial, listPrice, currency, altPrices };
}

function parsePaymentBlock(text: string, commercial: OfferCommercial): OfferCommercial {
  const lines = text
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean);
  const paymentModes: { name: string; details: string }[] = [];
  const deadlines: { name: string; days: number; appliesTo: string }[] = [];
  for (const line of lines) {
    const daysHit = line.match(/(\d+)\s*d[ií]as/i);
    if (/plazo/i.test(line) || daysHit) {
      const name = line
        .replace(/^plazo\s*/i, "")
        .replace(/\d+\s*d[ií]as/i, "")
        .replace(/\([^)]*\)/g, "")
        .trim();
      const applies = line.match(/\(([^)]+)\)/)?.[1] || "";
      deadlines.push({
        name: name || "Plazo",
        days: daysHit ? Number(daysHit[1]) : 0,
        appliesTo: applies.trim(),
      });
      continue;
    }
    const [name, ...rest] = line.split(/\s+[—\-–]\s+/);
    paymentModes.push({ name: name.trim(), details: rest.join(" — ").trim() });
  }
  return { ...commercial, paymentModes, deadlines };
}

function parseBonusBlock(text: string, commercial: OfferCommercial): OfferCommercial {
  const bonuses = text
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(/\s+[—\-–]\s+/);
      return { name: name.trim(), condition: rest.join(" — ").trim() };
    });
  return { ...commercial, bonuses };
}

export function applyOfferBlockPatch(
  offer: ExtractedOffer,
  id: OfferConfirmBlockId,
  text: string,
): ExtractedOffer {
  const value = text.trim();
  if (id === "name") {
    return { ...offer, productName: value || offer.productName };
  }
  if (id === "icp") {
    return { ...offer, icp: value };
  }
  if (id === "prices") {
    return { ...offer, commercial: parsePriceBlock(value, offer.commercial) };
  }
  if (id === "payments") {
    return { ...offer, commercial: parsePaymentBlock(value, offer.commercial) };
  }
  if (id === "bonuses") {
    return { ...offer, commercial: parseBonusBlock(value, offer.commercial) };
  }
  if (id === "commission") {
    if (!value) {
      return { ...offer, commercial: { ...offer.commercial, commission: null } };
    }
    return {
      ...offer,
      commercial: {
        ...offer.commercial,
        commission:
          parseCommissionFromText(value) || {
            notes: value,
            tiers: [],
            pctBase: 0,
            umbralAcumuladoUsd: 0,
            pctSobreUmbral: 0,
            base: "cash_collected",
            periodoAcumulacion: "mensual",
          },
      },
    };
  }
  return {
    ...offer,
    commercial: { ...offer.commercial, paymentDetails: value },
  };
}

export function confirmKey(offerIndex: number, id: OfferConfirmBlockId) {
  return `${offerIndex}:${id}`;
}

export function allOfferBlocksConfirmed(
  offerCount: number,
  confirmed: Record<string, boolean>,
) {
  if (offerCount < 1) return false;
  for (let index = 0; index < offerCount; index += 1) {
    for (const block of OFFER_CONFIRM_BLOCKS) {
      if (!confirmed[confirmKey(index, block.id)]) return false;
    }
  }
  return true;
}

export function emptyExtractedOffer(): ExtractedOffer {
  return {
    productName: "",
    productDescription: "",
    pitchSummary: "",
    icp: "",
    commercial: emptyCommercial(),
  };
}
