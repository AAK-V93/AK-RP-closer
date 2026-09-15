import type { PrismaClient } from "@prisma/client";
import {
  getPrisma,
  ensureCrmTables,
  ensureFathomTables,
  ensureWorkspaceTables,
  ensureCoachTables,
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
} from "@/lib/offer-commercial";

export async function getWorkspacePrisma() {
  const prisma = getPrisma();
  if (!prisma) return null;
  await ensureWorkspaceTables(prisma);
  try {
    await ensureFathomTables(prisma);
  } catch {
    /* fathom tables optional for uploads */
  }
  try {
    await ensureCrmTables(prisma);
  } catch {
    /* crm tables created on first use */
  }
  try {
    await ensureCoachTables(prisma);
  } catch {
    /* coach tables exist from prisma schema */
  }
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
  const oldest = [...offers].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
  const active =
    (offerId && offers.find((row) => row.id === offerId)) || offers[0] || null;

  const uploads = active
    ? await prisma.clientTranscript.findMany({
        where: {
          userId,
          OR: [
            { offerId: active.id },
            ...(oldest && oldest.id === active.id ? [{ offerId: null }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 80,
        select: {
          id: true,
          title: true,
          source: true,
          createdAt: true,
          transcriptText: true,
          offerId: true,
        },
      })
    : [];

  let fathomCount = 0;
  let fathomSamples: { title: string; transcriptText: string }[] = [];
  try {
    fathomCount = await prisma.fathomRecording.count({
      where: {
        userId,
        AND: [
          { transcriptText: { not: "" } },
          { transcriptText: { not: EMPTY_TRANSCRIPT_MARK } },
        ],
      },
    });
    if (includeCorpus && active?.includeFathom && fathomCount > 0) {
      fathomSamples = await prisma.fathomRecording.findMany({
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
      });
    }
  } catch {
    fathomCount = 0;
    fathomSamples = [];
  }

  const usableUploads = uploads.filter((row) =>
    isUsableTranscript(row.transcriptText),
  ).length;
  const playbook = active ? parsePlaybook(active.playbook) : emptyPlaybook();
  const transcriptCount = usableUploads + (active?.includeFathom ? fathomCount : 0);
  const offerReady = Boolean(active?.productName.trim()) && transcriptCount > 0;
  const uploadCounts = await prisma.clientTranscript.groupBy({
    by: ["offerId"],
    where: { userId },
    _count: { _all: true },
  });
  const canPractice = offers.some((row) => Boolean(row.productName.trim()));

  return {
    offers: offers.map((row) => ({
      id: row.id,
      productName: row.productName,
      productDescription: row.productDescription,
      pitchSummary: row.pitchSummary,
      includeFathom: row.includeFathom,
      commercial: parseCommercial(row.commercial),
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
          commercial: parseCommercial(active.commercial),
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
    corpus: [
      ...uploads.map((row) => ({
        title: row.title,
        text: row.transcriptText,
      })),
      ...fathomSamples.map((row) => ({
        title: row.title,
        text: row.transcriptText,
      })),
    ],
  };
}

export function playbookFromOffer(
  playbook: LeadPlaybook | null | undefined,
): LeadPlaybook {
  return playbook && isPlaybookReady(playbook) ? playbook : emptyPlaybook();
}
