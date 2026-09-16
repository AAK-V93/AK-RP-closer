import { parseFollowupScripts, type FollowupScript } from "@/lib/followup-scripts";

export type CommissionTier = {
  when: string;
  label: string;
  pct: number | null;
  daysMax: number | null;
  paymentMode: string;
};

export type CommissionRuleInput = {
  notes: string;
  tiers: CommissionTier[];
  pctBase: number;
  umbralAcumuladoUsd: number;
  pctSobreUmbral: number;
  base: "cash_collected" | "venta_total";
  periodoAcumulacion: "mensual" | "anual" | "total";
};

export type OfferAltPrice = { label: string; amount: number | null };
export type OfferPaymentMode = { name: string; details: string };
export type OfferDeadline = { name: string; days: number; appliesTo: string };
export type OfferBonus = { name: string; condition: string };

export type OfferCommercial = {
  aliases: string[];
  listPrice: number | null;
  currency: string;
  fxRate: number | null;
  altPrices: OfferAltPrice[];
  paymentModes: OfferPaymentMode[];
  deadlines: OfferDeadline[];
  bonuses: OfferBonus[];
  paymentDetails: string;
  duration: string;
  commission: CommissionRuleInput | null;
  scripts: FollowupScript[];
  sourceText: string;
};

export type OfferForCrm = {
  id: string;
  productName: string;
  productDescription: string;
  commercial: OfferCommercial;
};

export type ExtractedOffer = {
  productName: string;
  productDescription: string;
  pitchSummary: string;
  icp: string;
  commercial: OfferCommercial;
};

export type ExtractedOfferBatch = {
  offers: ExtractedOffer[];
  assumption: "una" | "varias";
  questions: string[];
};

export function emptyCommercial(): OfferCommercial {
  return {
    aliases: [],
    listPrice: null,
    currency: "USD",
    fxRate: null,
    altPrices: [],
    paymentModes: [],
    deadlines: [],
    bonuses: [],
    paymentDetails: "",
    duration: "",
    commission: null,
    scripts: [],
    sourceText: "",
  };
}

export function defaultCommissionRule(): CommissionRuleInput {
  return {
    notes: "",
    tiers: [],
    pctBase: 0.03,
    umbralAcumuladoUsd: 70_000,
    pctSobreUmbral: 0.05,
    base: "cash_collected",
    periodoAcumulacion: "mensual",
  };
}

function num(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function pct(raw: unknown): number | null {
  const n = num(raw);
  if (n == null) return null;
  return n > 1 ? n / 100 : n;
}

function parseTiers(raw: unknown): CommissionTier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = (item || {}) as Record<string, unknown>;
      return {
        when: String(row.when || row.cuando || "").trim(),
        label: String(row.label || row.nombre || "").trim(),
        pct: pct(row.pct ?? row.porcentaje),
        daysMax: num(row.daysMax ?? row.days_max ?? row.plazoDias ?? row.days),
        paymentMode: String(row.paymentMode || row.modo_pago || row.modo || "").trim(),
      };
    })
    .filter((row) => row.when || row.label || row.paymentMode || row.pct != null);
}

function parseCommissionRule(raw: unknown): CommissionRuleInput | null {
  if (!raw || typeof raw !== "object") return null;
  const commissionRaw = raw as Record<string, unknown>;
  const notes = String(
    commissionRaw.notes || commissionRaw.regla || commissionRaw.narrativa || "",
  ).trim();
  const tiers = parseTiers(commissionRaw.tiers || commissionRaw.tramos);
  const pctBase = pct(commissionRaw.pctBase ?? commissionRaw.pct_base);
  if (!notes && !tiers.length && pctBase == null) return null;
  const firstTierPct = tiers.find((row) => row.pct != null)?.pct ?? 0;
  const umbral = num(commissionRaw.umbralAcumuladoUsd ?? commissionRaw.umbral);
  return {
    notes,
    tiers,
    pctBase: pctBase ?? firstTierPct,
    umbralAcumuladoUsd: umbral ?? 0,
    pctSobreUmbral:
      pct(commissionRaw.pctSobreUmbral ?? commissionRaw.pct_sobre) ??
      pctBase ??
      firstTierPct,
    base: String(commissionRaw.base || "cash_collected").includes("venta")
      ? "venta_total"
      : "cash_collected",
    periodoAcumulacion: ["anual", "total"].includes(
      String(commissionRaw.periodoAcumulacion || commissionRaw.periodo),
    )
      ? (String(
          commissionRaw.periodoAcumulacion || commissionRaw.periodo,
        ) as "anual" | "total")
      : "mensual",
  };
}

export function parseCommercial(raw: unknown): OfferCommercial {
  const value = (raw || {}) as Record<string, unknown>;
  return {
    aliases: Array.isArray(value.aliases)
      ? value.aliases.map(String).map((item) => item.trim()).filter(Boolean)
      : [],
    listPrice: num(value.listPrice ?? value.precio_lista),
    currency: String(value.currency || value.moneda || "USD").trim() || "USD",
    fxRate: num(value.fxRate ?? value.tipo_cambio),
    altPrices: Array.isArray(value.altPrices)
      ? value.altPrices.map((item) => {
          const row = (item || {}) as Record<string, unknown>;
          return {
            label: String(row.label || "").trim(),
            amount: num(row.amount),
          };
        })
      : [],
    paymentModes: Array.isArray(value.paymentModes)
      ? value.paymentModes
          .map((item) => {
            const row = (item || {}) as Record<string, unknown>;
            return {
              name: String(row.name || "").trim(),
              details: String(row.details || "").trim(),
            };
          })
          .filter((row) => row.name)
      : [],
    deadlines: Array.isArray(value.deadlines)
      ? value.deadlines
          .map((item) => {
            const row = (item || {}) as Record<string, unknown>;
            return {
              name: String(row.name || "").trim(),
              days: num(row.days) || 0,
              appliesTo: String(row.appliesTo || "").trim(),
            };
          })
          .filter((row) => row.name)
      : [],
    bonuses: Array.isArray(value.bonuses)
      ? value.bonuses
          .map((item) => {
            const row = (item || {}) as Record<string, unknown>;
            return {
              name: String(row.name || "").trim(),
              condition: String(row.condition || "").trim(),
            };
          })
          .filter((row) => row.name)
      : [],
    paymentDetails: String(value.paymentDetails || value.datos_pago || "").trim(),
    duration: String(value.duration || value.duracion || "").trim(),
    commission: parseCommissionRule(value.commission),
    scripts: parseFollowupScripts(value.scripts || value.seguimientos),
    sourceText: String(value.sourceText || "").trim(),
  };
}

export function isOfferCrmReady(offer: {
  productName?: string | null;
  commercial?: unknown;
}) {
  const commercial = parseCommercial(offer.commercial);
  return Boolean(
    String(offer.productName || "").trim() &&
      commercial.listPrice &&
      commercial.listPrice > 0 &&
      commercial.paymentModes.length > 0 &&
      commercial.commission,
  );
}

export function userHasReadyCrm(
  offers: { productName?: string | null; commercial?: unknown }[],
) {
  return offers.some(isOfferCrmReady);
}

export type MissingCrmField = {
  offerId: string;
  offerName: string;
  field: string;
  question: string;
};

export function crmGaps(offer: {
  productName?: string | null;
  commercial?: unknown;
}): string[] {
  const commercial = parseCommercial(offer.commercial);
  const gaps: string[] = [];
  if (!String(offer.productName || "").trim()) gaps.push("nombre");
  if (!commercial.listPrice) gaps.push("precio de lista");
  if (!commercial.paymentModes.length) gaps.push("modos de pago");
  if (!commercial.commission) {
    gaps.push("cómo te pagan comisión (plazo, forma de pago, %)");
  }
  return gaps;
}

export function commissionSummary(rule: CommissionRuleInput | null): string {
  if (!rule) return "";
  if (rule.tiers.length) {
    return rule.tiers
      .map((tier) => {
        const name = tier.label || tier.when || tier.paymentMode;
        const pctLabel =
          tier.pct != null ? `${Math.round(tier.pct * 1000) / 10}%` : "";
        return [name, pctLabel].filter(Boolean).join(" ");
      })
      .join(" · ");
  }
  if (rule.notes) return rule.notes.length > 240 ? `${rule.notes.slice(0, 237)}…` : rule.notes;
  if (rule.pctBase > 0) {
    const base = `${Math.round(rule.pctBase * 1000) / 10}%`;
    if (rule.umbralAcumuladoUsd > 0) {
      return `${base} hasta ${rule.umbralAcumuladoUsd}, luego ${Math.round(rule.pctSobreUmbral * 1000) / 10}%`;
    }
    return base;
  }
  return "";
}

export function commercialRecap(commercial: OfferCommercial): string {
  const bits: string[] = [];
  if (commercial.listPrice) {
    bits.push(`lista ${commercial.currency} ${commercial.listPrice}`);
  }
  if (commercial.paymentModes.length) {
    bits.push(commercial.paymentModes.map((row) => row.name).join(", "));
  }
  const commission = commissionSummary(commercial.commission);
  if (commission) bits.push(`comisión: ${commission}`);
  return bits.join(" · ");
}

export function nextMissingCrmField(
  offers: { id: string; productName: string; commercial?: unknown }[],
): MissingCrmField | null {
  const blobHint =
    "Pega un solo texto o súbelo en Ofertas (PDF/TXT): precios, cómo paga el lead y cómo te pagan comisión según plazo o forma de pago. No hace falta ir dato por dato.";

  if (!offers.length) {
    return {
      offerId: "",
      offerName: "",
      field: "oferta_doc",
      question: `Para registrar ventas y comisiones, ${blobHint.charAt(0).toLowerCase()}${blobHint.slice(1)}`,
    };
  }

  const incomplete = offers.find((row) => !isOfferCrmReady(row)) || offers[0];
  if (isOfferCrmReady(incomplete) && offers.some(isOfferCrmReady)) return null;

  const gaps = crmGaps(incomplete);
  if (!gaps.length) return null;

  const commercial = parseCommercial(incomplete.commercial);
  const recap = commercialRecap(commercial);
  const name = incomplete.productName || "tu oferta";
  const head = recap
    ? `En ${name} ya tengo: ${recap}. Falta ${gaps.join(", ")}.`
    : `Para ${name} falta ${gaps.join(", ")}.`;

  return {
    offerId: incomplete.id,
    offerName: name,
    field: "oferta_doc",
    question: `${head} ${blobHint}`,
  };
}

export function matchOfferName(
  offers: OfferForCrm[],
  raw: string | null | undefined,
): OfferForCrm | null {
  const needle = String(raw || "")
    .trim()
    .toLowerCase();
  if (!needle || needle === "otros" || needle === "null") return null;
  for (const offer of offers) {
    const names = [offer.productName, ...offer.commercial.aliases]
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (names.some((name) => name === needle || name.includes(needle) || needle.includes(name))) {
      return offer;
    }
  }
  return null;
}

export function deadlineDaysForPago(offer: OfferForCrm | null, modoPago: string | null) {
  if (!offer) return null;
  const modo = String(modoPago || "").toLowerCase();
  const hit = offer.commercial.deadlines.find((row) => {
    const hay = `${row.name} ${row.appliesTo}`.toLowerCase();
    return (
      (modo.includes("contado") && hay.includes("contado")) ||
      (modo.includes("reserva") && hay.includes("reserva")) ||
      (modo && hay.includes(modo))
    );
  });
  return hit?.days || null;
}

export function looksLikeOfferBlob(text: string) {
  const value = text.trim();
  if (value.length >= 80) return true;
  return /comisi[oó]n|precio|pago|contado|reserva|cuota|%|usd|\$/i.test(value) && value.length >= 24;
}

export function applyCommercialAnswer(
  commercial: OfferCommercial,
  field: string,
  value: string,
): OfferCommercial {
  const next = { ...commercial };
  const text = value.trim();
  const amount = Number(text.replace(/[^\d.-]/g, ""));
  if (field === "oferta_doc") {
    next.sourceText = text.slice(0, 8000);
    const parsed = parseCommissionFromText(text);
    if (parsed) next.commission = parsed;
    if (!next.listPrice && Number.isFinite(amount) && amount > 50) {
      next.listPrice = amount;
    }
  }
  if (field === "precio_lista" && Number.isFinite(amount) && amount > 0) {
    next.listPrice = amount;
  }
  if (field === "modos_pago") {
    next.paymentModes = text
      .split(/[;|\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((name) => ({ name, details: "" }));
    if (!next.paymentModes.length) {
      next.paymentModes = [{ name: text, details: "" }];
    }
  }
  if (field === "regla_comision") {
    next.commission = parseCommissionFromText(text) || {
      notes: text,
      tiers: [],
      pctBase: 0,
      umbralAcumuladoUsd: 0,
      pctSobreUmbral: 0,
      base: "cash_collected",
      periodoAcumulacion: "mensual",
    };
  }
  if (field === "aliases") {
    next.aliases = text.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
  }
  if (field === "moneda") next.currency = text.toUpperCase().slice(0, 8) || "USD";
  if (field === "tipo_cambio" && Number.isFinite(amount)) next.fxRate = amount;
  if (field === "datos_pago") next.paymentDetails = text;
  if (field === "duracion") next.duration = text;
  return next;
}

export function parseCommissionFromText(text: string): CommissionRuleInput | null {
  const notes = text.trim();
  if (!notes) return null;
  const pcts = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) =>
    Number(m[1].replace(",", ".")),
  );
  const umbral = text.match(
    /(?:hasta|umbral|luego de|después de|acumulad[oa])\s*(\d[\d.\s,]{2,})/i,
  );
  let umbralAcumuladoUsd = 0;
  if (umbral) {
    const n = Number(umbral[1].replace(/[^\d]/g, ""));
    if (n > 100) umbralAcumuladoUsd = n;
  }
  const pctBase = pcts.length ? (pcts[0] > 1 ? pcts[0] / 100 : pcts[0]) : 0;
  const pctSobre =
    pcts[1] != null ? (pcts[1] > 1 ? pcts[1] / 100 : pcts[1]) : pctBase;
  if (!pcts.length && notes.length < 12) return null;
  return {
    notes,
    tiers: [],
    pctBase,
    umbralAcumuladoUsd,
    pctSobreUmbral: pctSobre,
    base: /venta/i.test(text) ? "venta_total" : "cash_collected",
    periodoAcumulacion: /anual/i.test(text)
      ? "anual"
      : /total/i.test(text)
        ? "total"
        : "mensual",
  };
}

function mergeCommission(
  base: CommissionRuleInput | null,
  patch: CommissionRuleInput | null,
): CommissionRuleInput | null {
  if (!patch) return base;
  if (!base) return patch;
  const notes =
    patch.notes.length >= base.notes.length
      ? patch.notes
      : [base.notes, patch.notes].filter(Boolean).join("\n");
  return {
    notes,
    tiers: patch.tiers.length ? patch.tiers : base.tiers,
    pctBase: patch.pctBase || base.pctBase,
    umbralAcumuladoUsd: patch.umbralAcumuladoUsd || base.umbralAcumuladoUsd,
    pctSobreUmbral: patch.pctSobreUmbral || base.pctSobreUmbral,
    base: patch.base || base.base,
    periodoAcumulacion: patch.periodoAcumulacion || base.periodoAcumulacion,
  };
}

export function mergeCommercial(
  base: OfferCommercial,
  patch: OfferCommercial,
): OfferCommercial {
  const aliases = [...base.aliases];
  for (const alias of patch.aliases) {
    if (!aliases.some((row) => row.toLowerCase() === alias.toLowerCase())) {
      aliases.push(alias);
    }
  }
  return {
    aliases,
    listPrice: patch.listPrice || base.listPrice,
    currency:
      patch.currency && patch.currency !== "USD" ? patch.currency : base.currency || patch.currency,
    fxRate: patch.fxRate ?? base.fxRate,
    altPrices: patch.altPrices.length ? patch.altPrices : base.altPrices,
    paymentModes: patch.paymentModes.length ? patch.paymentModes : base.paymentModes,
    deadlines: patch.deadlines.length ? patch.deadlines : base.deadlines,
    bonuses: patch.bonuses.length ? patch.bonuses : base.bonuses,
    paymentDetails: patch.paymentDetails || base.paymentDetails,
    duration: patch.duration || base.duration,
    commission: mergeCommission(base.commission, patch.commission),
    scripts: base.scripts.length ? base.scripts : patch.scripts,
    sourceText: patch.sourceText || base.sourceText,
  };
}

export function mergeExtractedOffer(
  current: {
    productName: string;
    productDescription: string;
    pitchSummary: string;
    icp?: string;
    commercial: OfferCommercial;
  },
  extracted: ExtractedOffer,
): ExtractedOffer {
  return {
    productName: extracted.productName || current.productName,
    productDescription:
      extracted.productDescription.length >= 20 &&
      extracted.productDescription.length >= current.productDescription.length
        ? extracted.productDescription
        : current.productDescription || extracted.productDescription,
    pitchSummary: extracted.pitchSummary || current.pitchSummary,
    icp: extracted.icp || current.icp || "",
    commercial: mergeCommercial(current.commercial, extracted.commercial),
  };
}

export function collapseOffersToOne(offers: ExtractedOffer[]): ExtractedOffer {
  if (!offers.length) {
    return {
      productName: "Oferta",
      productDescription: "Oferta extraída",
      pitchSummary: "",
      icp: "",
      commercial: emptyCommercial(),
    };
  }
  if (offers.length === 1) return offers[0];
  let commercial = offers[0].commercial;
  for (const extra of offers.slice(1)) {
    commercial = mergeCommercial(commercial, extra.commercial);
  }
  const extraNames = offers.slice(1).map((row) => row.productName).filter(Boolean);
  return {
    productName: offers[0].productName,
    productDescription: offers
      .map((row) =>
        row.productName && row.productName !== offers[0].productName
          ? `${row.productName}: ${row.productDescription}`
          : row.productDescription,
      )
      .filter(Boolean)
      .join("\n\n"),
    pitchSummary: offers.find((row) => row.pitchSummary)?.pitchSummary || "",
    icp: offers.find((row) => row.icp?.trim())?.icp || "",
    commercial: {
      ...commercial,
      aliases: [...commercial.aliases, ...extraNames].filter(
        (name, index, all) =>
          name &&
          name.toLowerCase() !== offers[0].productName.toLowerCase() &&
          all.findIndex((item) => item.toLowerCase() === name.toLowerCase()) === index,
      ),
    },
  };
}

export function offerToSavePayload(offer: ExtractedOffer) {
  const description =
    offer.productDescription.trim().length >= 20
      ? offer.productDescription.trim()
      : `${offer.productDescription.trim() || offer.productName} — oferta extraída`;
  return {
    productName: offer.productName.trim() || "Oferta",
    productDescription: description.slice(0, 8000),
    pitchSummary: offer.pitchSummary,
    icp: (offer.icp || "").trim(),
    commercial: offer.commercial,
  };
}
