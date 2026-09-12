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

export async function getWorkspace(prisma: PrismaClient, userId: string) {
  const [offer, uploads] = await Promise.all([
    prisma.userOffer.findUnique({ where: { userId } }),
    prisma.clientTranscript.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        title: true,
        source: true,
        createdAt: true,
        transcriptText: true,
      },
    }),
  ]);

  let fathomCount = 0;
  let fathomSamples: { title: string; transcriptText: string }[] = [];
  try {
    [fathomCount, fathomSamples] = await Promise.all([
      prisma.fathomRecording.count({
        where: {
          userId,
          AND: [
            { transcriptText: { not: "" } },
            { transcriptText: { not: EMPTY_TRANSCRIPT_MARK } },
          ],
        },
      }),
      prisma.fathomRecording.findMany({
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
      }),
    ]);
  } catch {
    fathomCount = 0;
    fathomSamples = [];
  }

  const uploadCount = uploads.length;
  const usableUploads = uploads.filter((row) =>
    isUsableTranscript(row.transcriptText),
  ).length;
  const playbook = offer ? parsePlaybook(offer.playbook) : emptyPlaybook();
  const transcriptCount = usableUploads + fathomCount;
  const ready = Boolean(offer?.productName.trim()) && transcriptCount > 0;

  return {
    offer: offer
      ? {
          id: offer.id,
          productName: offer.productName,
          productDescription: offer.productDescription,
          pitchSummary: offer.pitchSummary,
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
    uploadCount,
    fathomCount,
    transcriptCount,
    ready,
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
