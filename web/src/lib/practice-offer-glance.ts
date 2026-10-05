import {
  describeOfferPrices,
  parseCommercial,
  savedBonusNames,
} from "@/lib/offer-commercial";
import { countPhrase } from "@/lib/plain-labels";
import { clipVisible } from "@/lib/visible-text";

/** Chip text for the offer switcher. No trailing dot when a status is missing. */
export function offerSwitchLabel(name: string, bonusCount: number) {
  const clean = String(name || "").replace(/\s+/g, " ").trim() || "Oferta";
  const count = Math.max(0, Math.trunc(Number(bonusCount) || 0));
  if (count <= 0) return clean;
  return `${clean} · ${count === 1 ? "1 bono" : `${count} bonos`}`;
}

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

export type OfferPracticeMaterial = {
  line: string;
  imported: number;
  recordings: number;
};

/**
 * Ofertas counts practice material (imported texts, plus recordings when the
 * offer uses them). Coach counts llamadas con persona. The numbers stay as
 * stored; only the label separates the two piles.
 */
export function offerPracticeMaterialLine(input: {
  transcriptCount?: number;
  fathomCount?: number;
  includeFathom?: boolean;
}): OfferPracticeMaterial {
  const total = Math.max(0, Math.trunc(Number(input.transcriptCount) || 0));
  const fathom = Math.max(0, Math.trunc(Number(input.fathomCount) || 0));
  const recordings = input.includeFathom && fathom > 0 && fathom <= total ? fathom : 0;
  const imported = total - recordings;
  const parts: string[] = [];
  if (imported > 0) parts.push(countPhrase(imported, "transcripción", "transcripciones"));
  if (recordings > 0) parts.push(countPhrase(recordings, "grabación", "grabaciones"));
  if (!parts.length) {
    return {
      line: "Todavía no hay transcripciones ni grabaciones para practicar.",
      imported: 0,
      recordings: 0,
    };
  }
  const split = parts.join(" y ");
  if (recordings > 0 && imported > 0) {
    return {
      line: `${split} para practicar esta oferta (${total} en total). Las llamadas con persona están en Coach.`,
      imported,
      recordings,
    };
  }
  const line =
    recordings > 0
      ? `${split} para practicar esta oferta. Las llamadas con persona están en Coach.`
      : `${split} para practicar esta oferta.`;
  return { line, imported, recordings };
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
