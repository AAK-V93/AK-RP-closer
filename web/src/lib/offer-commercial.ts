import { parseFollowupScripts, type FollowupScript } from "@/lib/followup-scripts";

export type CommissionRuleInput = {
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
};

export type OfferForCrm = {
  id: string;
  productName: string;
  productDescription: string;
  commercial: OfferCommercial;
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
  };
}

export function defaultCommissionRule(): CommissionRuleInput {
  return {
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

export function parseCommercial(raw: unknown): OfferCommercial {
  const value = (raw || {}) as Record<string, unknown>;
  const commissionRaw = (value.commission || {}) as Record<string, unknown>;
  const hasCommission =
    value.commission &&
    (num(commissionRaw.pctBase) != null || num(commissionRaw.pct_base) != null);
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
      ? value.paymentModes.map((item) => {
          const row = (item || {}) as Record<string, unknown>;
          return {
            name: String(row.name || "").trim(),
            details: String(row.details || "").trim(),
          };
        }).filter((row) => row.name)
      : [],
    deadlines: Array.isArray(value.deadlines)
      ? value.deadlines.map((item) => {
          const row = (item || {}) as Record<string, unknown>;
          return {
            name: String(row.name || "").trim(),
            days: num(row.days) || 0,
            appliesTo: String(row.appliesTo || "").trim(),
          };
        }).filter((row) => row.name)
      : [],
    bonuses: Array.isArray(value.bonuses)
      ? value.bonuses.map((item) => {
          const row = (item || {}) as Record<string, unknown>;
          return {
            name: String(row.name || "").trim(),
            condition: String(row.condition || "").trim(),
          };
        }).filter((row) => row.name)
      : [],
    paymentDetails: String(value.paymentDetails || value.datos_pago || "").trim(),
    duration: String(value.duration || value.duracion || "").trim(),
    commission: hasCommission
      ? {
          pctBase: num(commissionRaw.pctBase ?? commissionRaw.pct_base) ?? 0.03,
          umbralAcumuladoUsd:
            num(commissionRaw.umbralAcumuladoUsd ?? commissionRaw.umbral) ??
            70_000,
          pctSobreUmbral:
            num(commissionRaw.pctSobreUmbral ?? commissionRaw.pct_sobre) ?? 0.05,
          base:
            String(commissionRaw.base || "cash_collected").includes("venta")
              ? "venta_total"
              : "cash_collected",
          periodoAcumulacion: ["anual", "total"].includes(
            String(commissionRaw.periodoAcumulacion || commissionRaw.periodo),
          )
            ? (String(
                commissionRaw.periodoAcumulacion || commissionRaw.periodo,
              ) as "anual" | "total")
            : "mensual",
        }
      : null,
    scripts: parseFollowupScripts(value.scripts || value.seguimientos),
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

export function nextMissingCrmField(
  offers: { id: string; productName: string; commercial?: unknown }[],
): MissingCrmField | null {
  if (!offers.length) {
    return {
      offerId: "",
      offerName: "",
      field: "oferta",
      question:
        "Para registrar ventas y comisiones necesito los detalles de tu oferta. ¿Tienes un PDF o me los cuentas?",
    };
  }

  const incomplete = offers.find((row) => !isOfferCrmReady(row)) || offers[0];
  if (isOfferCrmReady(incomplete) && offers.some(isOfferCrmReady)) return null;

  const commercial = parseCommercial(incomplete.commercial);
  const name = incomplete.productName || "tu oferta";
  if (!incomplete.productName.trim()) {
    return {
      offerId: incomplete.id,
      offerName: name,
      field: "nombre",
      question: "¿Cómo se llama la oferta que vendes?",
    };
  }
  if (!commercial.listPrice) {
    return {
      offerId: incomplete.id,
      offerName: name,
      field: "precio_lista",
      question: `¿Cuál es el precio de lista de ${name}? (en USD)`,
    };
  }
  if (!commercial.paymentModes.length) {
    return {
      offerId: incomplete.id,
      offerName: name,
      field: "modos_pago",
      question: `¿Qué modos de pago aceptas en ${name}? (contado, reserva, cuotas…)`,
    };
  }
  if (!commercial.commission) {
    return {
      offerId: incomplete.id,
      offerName: name,
      field: "regla_comision",
      question: `¿Cuál es tu comisión sobre ${name}? (ej: 3% hasta 70,000 y 5% después, sobre lo cobrado)`,
    };
  }
  return null;
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

export function applyCommercialAnswer(
  commercial: OfferCommercial,
  field: string,
  value: string,
): OfferCommercial {
  const next = { ...commercial };
  const text = value.trim();
  const amount = Number(text.replace(/[^\d.-]/g, ""));
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
      ...defaultCommissionRule(),
      pctBase: Number.isFinite(amount) && amount <= 100 ? amount / 100 : 0.03,
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
  const pcts = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) =>
    Number(m[1].replace(",", ".")),
  );
  const umbral = text.match(/(\d[\d.\s,]{2,})\s*(?:usd|dolares|dólares)?/i);
  if (!pcts.length) return null;
  const pctBase = pcts[0] > 1 ? pcts[0] / 100 : pcts[0];
  const pctSobre = pcts[1] != null ? (pcts[1] > 1 ? pcts[1] / 100 : pcts[1]) : pctBase;
  let umbralAcumuladoUsd = 70_000;
  if (umbral) {
    const n = Number(umbral[1].replace(/[^\d]/g, ""));
    if (n > 100) umbralAcumuladoUsd = n;
  }
  return {
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
