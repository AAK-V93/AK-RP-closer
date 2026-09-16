import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { persistCommissionRule } from "@/lib/commission";
import { emptyPlaybook, parsePlaybook } from "@/lib/lead-playbook";
import {
  applyOfferExtractFeedback,
  extractOfferBatchFromText,
  isOfferExtractConfirm,
  offerBatchRecap,
} from "@/lib/offer-extract";
import {
  crmGaps,
  mergeExtractedOffer,
  nextMissingCrmField,
  offerToSavePayload,
  parseCommercial,
  type ExtractedOffer,
  type ExtractedOfferBatch,
} from "@/lib/offer-commercial";

const PENDING_KEY = "pendingOfferExtract";

export type PendingOfferExtract = ExtractedOfferBatch & {
  targetOfferId?: string;
};

function prefsObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
}

export function readPendingOfferExtract(raw: unknown): PendingOfferExtract | null {
  const value = prefsObject(raw)[PENDING_KEY];
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const offers = Array.isArray(row.offers) ? row.offers : [];
  const parsed: ExtractedOffer[] = offers
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const offer = item as Record<string, unknown>;
      return {
        productName: String(offer.productName || "").trim(),
        productDescription: String(offer.productDescription || "").trim(),
        pitchSummary: String(offer.pitchSummary || "").trim(),
        icp: String(offer.icp || "").trim(),
        commercial: parseCommercial(offer.commercial),
      };
    })
    .filter((offer) => offer.productName || offer.productDescription.length >= 20);
  if (!parsed.length) return null;
  return {
    offers: parsed,
    assumption: parsed.length > 1 ? "varias" : row.assumption === "varias" ? "varias" : "una",
    questions: Array.isArray(row.questions) ? row.questions.map(String) : [],
    targetOfferId: String(row.targetOfferId || "") || undefined,
  };
}

async function writePending(
  prisma: PrismaClient,
  userId: string,
  pending: PendingOfferExtract | null,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmPrefs: true },
  });
  const prefs = prefsObject(user?.crmPrefs);
  if (pending) prefs[PENDING_KEY] = pending;
  else delete prefs[PENDING_KEY];
  await prisma.user.update({
    where: { id: userId },
    data: { crmPrefs: prefs as Prisma.InputJsonValue },
  });
}

export async function clearPendingOfferExtract(prisma: PrismaClient, userId: string) {
  await writePending(prisma, userId, null);
}

export async function persistExtractedOffers(
  prisma: PrismaClient,
  userId: string,
  offers: ExtractedOffer[],
  targetOfferId?: string,
) {
  const existing = await prisma.userOffer.findMany({ where: { userId } });
  const names: string[] = [];
  for (let index = 0; index < offers.length; index += 1) {
    const payload = offerToSavePayload(offers[index]);
    const mergeInto =
      index === 0 && targetOfferId
        ? existing.find((row) => row.id === targetOfferId) || null
        : null;

    if (mergeInto) {
      const merged = mergeExtractedOffer(
        {
          productName: mergeInto.productName,
          productDescription: mergeInto.productDescription,
          pitchSummary: mergeInto.pitchSummary,
          icp: parsePlaybook(mergeInto.playbook).icp,
          commercial: parseCommercial(mergeInto.commercial),
        },
        payload,
      );
      const playbook = {
        ...parsePlaybook(mergeInto.playbook),
        ...(merged.icp ? { icp: merged.icp } : {}),
      };
      const offer = await prisma.userOffer.update({
        where: { id: mergeInto.id },
        data: {
          productName: merged.productName || mergeInto.productName,
          productDescription:
            merged.productDescription.length >= 20
              ? merged.productDescription
              : mergeInto.productDescription,
          pitchSummary: merged.pitchSummary,
          commercial: merged.commercial as unknown as Prisma.InputJsonValue,
          playbook: playbook as unknown as Prisma.InputJsonValue,
        },
      });
      if (merged.commercial.commission) {
        await persistCommissionRule(prisma, userId, offer.id, merged.commercial.commission);
      }
      names.push(offer.productName);
      continue;
    }

    const offer = await prisma.userOffer.create({
      data: {
        userId,
        productName: payload.productName,
        productDescription: payload.productDescription,
        pitchSummary: payload.pitchSummary,
        includeFathom: existing.length === 0 && index === 0,
        commercial: payload.commercial as unknown as Prisma.InputJsonValue,
        ...(payload.icp
          ? {
              playbook: {
                ...emptyPlaybook(),
                icp: payload.icp,
              } as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    if (payload.commercial.commission) {
      await persistCommissionRule(prisma, userId, offer.id, payload.commercial.commission);
    }
    names.push(offer.productName);
  }

  const nextOffers = await prisma.userOffer.findMany({ where: { userId } });
  const nextQ = nextMissingCrmField(
    nextOffers.map((row) => ({
      id: row.id,
      productName: row.productName,
      commercial: row.commercial,
    })),
  );
  const gaps = nextOffers.flatMap((row) => crmGaps(row));
  return { names, nextQ, gaps };
}

export async function stageOfferBlob(
  prisma: PrismaClient,
  userId: string,
  text: string,
  offerId?: string,
) {
  const batch = await extractOfferBatchFromText(text);
  const pending: PendingOfferExtract = {
    ...batch,
    targetOfferId: offerId || undefined,
  };
  await writePending(prisma, userId, pending);
  return {
    pending,
    recap: offerBatchRecap(pending),
  };
}

export async function revisePendingOfferExtract(
  prisma: PrismaClient,
  userId: string,
  feedback: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmPrefs: true },
  });
  const pending = readPendingOfferExtract(user?.crmPrefs);
  if (!pending) return null;
  const batch = await applyOfferExtractFeedback(pending, feedback);
  const next = { ...pending, ...batch };
  await writePending(prisma, userId, next);
  return next;
}

export async function confirmPendingOfferExtract(
  prisma: PrismaClient,
  userId: string,
  feedback: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmPrefs: true },
  });
  const pending = readPendingOfferExtract(user?.crmPrefs);
  if (!pending) return null;
  const batch = isOfferExtractConfirm(feedback)
    ? pending
    : await applyOfferExtractFeedback(pending, feedback);
  const saved = await persistExtractedOffers(
    prisma,
    userId,
    batch.offers,
    pending.targetOfferId,
  );
  await writePending(prisma, userId, null);
  return { ...saved, batch };
}

/** @deprecated stage + confirm */
export async function ingestOfferBlob(
  prisma: PrismaClient,
  userId: string,
  text: string,
  offerId?: string,
) {
  const staged = await stageOfferBlob(prisma, userId, text, offerId);
  return {
    nextQ: null,
    recap: staged.recap,
    gaps: [],
    productName: staged.pending.offers.map((row) => row.productName).join(", "),
    pending: true as const,
  };
}
