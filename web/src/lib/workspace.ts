import { Prisma, type PrismaClient } from "@prisma/client";
import {
  getPrisma,
  ensureCrmTables,
  ensureFathomTables,
  ensureWorkspaceTables,
  ensureCoachTables,
  ensureReadIndexes,
} from "@/lib/prisma";
import {
  EMPTY_TRANSCRIPT_MARK,
  isUsableTranscript,
} from "@/lib/fathom-import";
import {
  emptyPlaybook,
  isPlaybookReady,
  parsePlaybook,
  type LeadPlaybook,
} from "@/lib/lead-playbook";
import { emptyLiveGuide, parseLiveGuide } from "@/lib/live-guide";
import {
  isOfferCrmReady,
  parseCommercial,
  userHasReadyCrm,
  withRecoveredBonuses,
  type OfferCommercial,
} from "@/lib/offer-commercial";
import { pickWorkspaceOffer } from "@/lib/offer-selection";

export async function getWorkspacePrisma() {
  const prisma = getPrisma();
  if (!prisma) return null;
  await Promise.all([
    ensureWorkspaceTables(prisma),
    ensureFathomTables(prisma).catch(() => undefined),
    ensureCrmTables(prisma).catch(() => undefined),
    ensureCoachTables(prisma).catch(() => undefined),
    ensureReadIndexes(prisma).catch(() => undefined),
  ]);
  return prisma;
}

export async function getWorkspace(
  prisma: PrismaClient,
  userId: string,
  offerId?: string | null,
  opts: { corpus?: boolean } = {},
) {
  const includeCorpus = opts.corpus !== false;
  const offers = await prisma.userOffer.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  const recoveredEntries = await Promise.all(
    offers.map(async (row) => {
      const commercial = await storeRecoveredBonuses(prisma, row.id, row.commercial);
      return [row.id, commercial] as const;
    }),
  );
  const recovered = new Map<string, OfferCommercial>(recoveredEntries);
  const oldest = [...offers].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
  const active = pickWorkspaceOffer(offers, offerId);
  const includeLegacy = Boolean(oldest && active && oldest.id === active.id);
  const transcriptWhere = active
    ? {
        userId,
        OR: [
          { offerId: active.id },
          ...(includeLegacy ? [{ offerId: null }] : []),
        ],
      }
    : null;

  const listSelect = {
    id: true,
    title: true,
    source: true,
    createdAt: true,
    offerId: true,
    ...(includeCorpus ? { transcriptText: true } : {}),
  } as const;

  let uploads: {
    id: string;
    title: string;
    source: string;
    createdAt: Date;
    offerId: string | null;
    transcriptText?: string;
  }[] = [];
  let usableUploads = 0;
  let fathomCount = 0;
  let fathomSamples: { title: string; transcriptText: string }[] = [];
  try {
    const [listed, usableRows, fathom] = await Promise.all([
      transcriptWhere
        ? prisma.clientTranscript.findMany({
            where: transcriptWhere,
            orderBy: { createdAt: "desc" },
            take: 80,
            select: listSelect,
          })
        : Promise.resolve([]),
      transcriptWhere
        ? prisma.$queryRaw<{ n: number }[]>`
            SELECT COUNT(*)::int AS n
            FROM "ClientTranscript"
            WHERE "userId" = ${userId}
              AND char_length(btrim("transcriptText")) >= 80
              AND "transcriptText" <> ${EMPTY_TRANSCRIPT_MARK}
              AND (
                "offerId" = ${active?.id || ""}
                OR (${includeLegacy} AND "offerId" IS NULL)
              )
          `
        : Promise.resolve([{ n: 0 }]),
      (async () => {
        const count = await prisma.fathomRecording.count({
          where: {
            userId,
            AND: [
              { transcriptText: { not: "" } },
              { transcriptText: { not: EMPTY_TRANSCRIPT_MARK } },
            ],
          },
        });
        const samples =
          includeCorpus && active?.includeFathom && count > 0
            ? await prisma.fathomRecording.findMany({
                where: {
                  userId,
                  AND: [
                    { transcriptText: { not: "" } },
                    { transcriptText: { not: EMPTY_TRANSCRIPT_MARK } },
                  ],
                },
                orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
                take: 40,
                select: { title: true, transcriptText: true },
              })
            : [];
        return { count, samples };
      })(),
    ]);
    uploads = listed;
    usableUploads = Number(usableRows[0]?.n || 0);
    fathomCount = fathom.count;
    fathomSamples = fathom.samples;
  } catch {
    fathomCount = 0;
    fathomSamples = [];
    usableUploads = uploads.filter((row) => isUsableTranscript(row.transcriptText)).length;
  }
  const playbook = active ? parsePlaybook(active.playbook) : emptyPlaybook();
  const transcriptCount = usableUploads + (active?.includeFathom ? fathomCount : 0);
  const offerReady = Boolean(active?.productName.trim()) && transcriptCount > 0;
  const canPractice = offers.some((row) => Boolean(row.productName.trim()));

  return {
    offers: offers.map((row) => ({
      id: row.id,
      productName: row.productName,
      productDescription: row.productDescription,
      pitchSummary: row.pitchSummary,
      includeFathom: row.includeFathom,
      commercial: recovered.get(row.id) || parseCommercial(row.commercial),
      readyCrm: isOfferCrmReady(row),
      updatedAt: row.updatedAt.toISOString(),
    })),
    offer: active
      ? {
          id: active.id,
          productName: active.productName,
          productDescription: active.productDescription,
          pitchSummary: active.pitchSummary,
          includeFathom: active.includeFathom,
          commercial: recovered.get(active.id) || parseCommercial(active.commercial),
          readyCrm: isOfferCrmReady(active),
        }
      : null,
    playbook,
    liveGuide: active ? parseLiveGuide(active.playbook, active.productName) : emptyLiveGuide(""),
    playbookReady: isPlaybookReady(playbook),
    transcripts: uploads.map((row) => ({
      id: row.id,
      title: row.title,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
    })),
    uploadCount: uploads.length,
    fathomCount,
    transcriptCount,
    ready: offerReady,
    readyCrm: userHasReadyCrm(offers),
    hasAnyOffer: offers.length > 0,
    canPractice,
    corpus: includeCorpus
      ? [
          ...uploads.map((row) => ({
            title: row.title,
            text: row.transcriptText || "",
          })),
          ...fathomSamples.map((row) => ({
            title: row.title,
            text: row.transcriptText,
          })),
        ]
      : [],
  };
}

export function playbookFromOffer(
  playbook: LeadPlaybook | null | undefined,
): LeadPlaybook {
  return playbook && isPlaybookReady(playbook) ? playbook : emptyPlaybook();
}

const PRACTICE_OFFER_SELECT = {
  id: true,
  productName: true,
  productDescription: true,
  pitchSummary: true,
  playbook: true,
  commercial: true,
} as const;

/** One row update. Neon HTTP cannot run updateMany, deleteMany, or a transaction. */
async function storeRecoveredBonuses(prisma: PrismaClient, id: string, raw: unknown) {
  const parsed = parseCommercial(raw);
  const next = withRecoveredBonuses(parsed);
  if (!parsed.bonuses.length && next.bonuses.length) {
    try {
      await prisma.userOffer.update({
        where: { id },
        data: { commercial: next as unknown as Prisma.InputJsonValue },
      });
    } catch (error) {
      console.error("offer bonus backfill", id, error);
    }
  }
  return next;
}

/**
 * Offer row for voice practice. One indexed read, no transcript bodies.
 * The token route used to call getWorkspace, which pulled up to 80 call
 * transcripts and 40 Fathom transcripts before the room could open.
 */
export async function loadPracticeContext(
  prisma: PrismaClient,
  userId: string,
  offerId?: string | null,
  productName?: string | null,
) {
  const byId = offerId
    ? await prisma.userOffer.findFirst({
        where: { id: offerId, userId },
        select: PRACTICE_OFFER_SELECT,
      })
    : null;
  const byName =
    byId || !productName?.trim()
      ? null
      : await prisma.userOffer.findFirst({
          where: { userId, productName: productName.trim() },
          orderBy: { updatedAt: "desc" },
          select: PRACTICE_OFFER_SELECT,
        });
  const offer =
    byId ||
    byName ||
    (await prisma.userOffer.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: PRACTICE_OFFER_SELECT,
    }));
  if (!offer) return null;
  const playbook = parsePlaybook(offer.playbook);
  const commercial = await storeRecoveredBonuses(prisma, offer.id, offer.commercial);
  return {
    offer: {
      id: offer.id,
      productName: offer.productName,
      productDescription: offer.productDescription,
      pitchSummary: offer.pitchSummary,
      bonuses: commercial.bonuses.map((row) => row.name.trim()).filter(Boolean),
    },
    playbook,
    liveGuide: parseLiveGuide(offer.playbook, offer.productName),
  };
}
