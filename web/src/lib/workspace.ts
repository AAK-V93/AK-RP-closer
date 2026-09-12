import type { PrismaClient } from "@prisma/client";
import { getPrisma, ensureFathomTables, ensureWorkspaceTables } from "@/lib/prisma";
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

export async function getWorkspacePrisma() {
  const prisma = getPrisma();
  if (!prisma) return null;
  await ensureWorkspaceTables(prisma);
  try {
    await ensureFathomTables(prisma);
  } catch {
    /* fathom tables optional for uploads */
  }
  return prisma;
}

export async function getWorkspace(
  prisma: PrismaClient,
  userId: string,
  offerId?: string | null,
) {
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
    if (active?.includeFathom && fathomCount > 0) {
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
  const canPractice = offers.some((row) => {
    const own = uploadCounts.find((item) => item.offerId === row.id)?._count._all || 0;
    const legacy =
      oldest && oldest.id === row.id
        ? uploadCounts.find((item) => item.offerId === null)?._count._all || 0
        : 0;
    return own + legacy > 0 || (row.includeFathom && fathomCount > 0);
  });

  return {
    offers: offers.map((row) => ({
      id: row.id,
      productName: row.productName,
      productDescription: row.productDescription,
      pitchSummary: row.pitchSummary,
      includeFathom: row.includeFathom,
      updatedAt: row.updatedAt.toISOString(),
    })),
    offer: active
      ? {
          id: active.id,
          productName: active.productName,
          productDescription: active.productDescription,
          pitchSummary: active.pitchSummary,
          includeFathom: active.includeFathom,
        }
      : null,
    playbook,
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
