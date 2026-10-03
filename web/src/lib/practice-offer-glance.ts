import {
  describeOfferPrices,
  parseCommercial,
  savedBonusNames,
} from "@/lib/offer-commercial";
import { clipVisible } from "@/lib/visible-text";

export type PracticeOfferGlance = {
  blurb: string;
  prices: string[];
  bonusCount: number;
  bonusNames: string[];
};

function tidy(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clip(value: string, max = 160) {
  return clipVisible(value, max);
}

/** One or two lines. The stored description is often the whole PDF. */
export function shortOfferBlurb(input: {
  productName?: string | null;
  productDescription?: string | null;
  pitchSummary?: string | null;
}) {
  const name = tidy(input.productName);
  const pitch = tidy(input.pitchSummary);
  if (pitch && pitch.length <= 180 && pitch !== name) return pitch;
  let desc = tidy(input.productDescription);
  if (name && desc.toLowerCase().startsWith(name.toLowerCase())) {
    desc = desc.slice(name.length).trim();
  }
  const sentences = desc
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 12 && part !== name);
  if (!sentences.length) return clip(desc);
  return clip(sentences.slice(0, 2).join(" "));
}

/** A failed workspace read is not an empty offer. */
export function practiceOfferLoadState(input: { ok: boolean; offer?: unknown }) {
  if (!input.ok) return "error" as const;
  if (!input.offer) return "empty" as const;
  return "ready" as const;
}

export function practiceOfferGlance(input: {
  productName?: string | null;
  productDescription?: string | null;
  pitchSummary?: string | null;
  commercial?: unknown;
}): PracticeOfferGlance {
  const commercial = parseCommercial(input.commercial);
  const prices = describeOfferPrices(commercial)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/es el mismo que el precio de lista/i.test(line));
  const bonusNames = savedBonusNames(commercial);
  return {
    blurb: shortOfferBlurb(input),
    prices,
    bonusCount: bonusNames.length,
    bonusNames,
  };
}
