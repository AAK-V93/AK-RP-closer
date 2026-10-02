import type { PrismaClient } from "@prisma/client";
import { EMPTY_TRANSCRIPT_MARK, isUsableTranscript } from "@/lib/fathom-import";
import { nextMissingCrmField } from "@/lib/offer-commercial";

export type HomePhase = "a" | "b" | "c";

export type HomeState = {
  phase: HomePhase;
  hasOffer: boolean;
  hasRealCalls: boolean;
  fathomConnected: boolean;
  autoIngest: boolean;
  fathomCount: number;
  uploadCount: number;
  canPractice: boolean;
  showCrm: boolean;
  missingCrm: { offerId: string; field: string; question: string } | null;
  lastUnanalyzed: { id: string; title: string } | null;
};

const usableFathomWhere = {
  AND: [
    { transcriptText: { not: "" } },
    { transcriptText: { not: EMPTY_TRANSCRIPT_MARK } },
  ],
};

async function fathomHomeBits(prisma: PrismaClient, userId: string) {
  const [connection, fathomCount, pending] = await Promise.all([
    prisma.fathomConnection.findUnique({
      where: { userId },
      select: { webhookId: true },
    }),
    prisma.fathomRecording.count({
      where: { userId, ...usableFathomWhere },
    }),
    prisma.fathomRecording.findFirst({
      where: { userId, practiceSessionId: null, ...usableFathomWhere },
      orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
      select: { id: true, title: true, transcriptText: true },
    }),
  ]);
  return {
    fathomConnected: Boolean(connection),
    autoIngest: Boolean(connection?.webhookId),
    fathomCount,
    lastUnanalyzed:
      pending && isUsableTranscript(pending.transcriptText)
        ? { id: pending.id, title: pending.title }
        : null,
  };
}

export async function getHomeState(
  prisma: PrismaClient,
  userId: string,
): Promise<HomeState> {
  const [offers, fathom, uploadCount, filed] = await Promise.all([
    prisma.userOffer.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, productName: true, commercial: true },
    }),
    fathomHomeBits(prisma, userId).catch(() => ({
      fathomConnected: false,
      autoIngest: false,
      fathomCount: 0,
      lastUnanalyzed: null as HomeState["lastUnanalyzed"],
    })),
    prisma.clientTranscript.count({ where: { userId } }),
    prisma.callRecord.count({
      where: {
        userId,
        source: { in: ["fathom", "upload", "qc"] },
      },
    }),
  ]);
  const hasOffer = offers.some((row) => row.productName.trim());
  const { fathomCount, lastUnanalyzed, fathomConnected, autoIngest } = fathom;
  const hasRealCalls = fathomCount > 0 || uploadCount > 0 || filed > 0;

  const phase: HomePhase = hasOffer && hasRealCalls ? "c" : hasOffer ? "b" : "a";
  const missingCrm = nextMissingCrmField(
    offers.map((row) => ({
      id: row.id,
      productName: row.productName,
      commercial: row.commercial,
    })),
  );

  return {
    phase,
    hasOffer,
    hasRealCalls,
    fathomConnected,
    autoIngest,
    fathomCount,
    uploadCount,
    canPractice: hasOffer,
    showCrm: phase === "c",
    missingCrm,
    lastUnanalyzed,
  };
}
