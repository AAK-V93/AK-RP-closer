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

export async function getHomeState(
  prisma: PrismaClient,
  userId: string,
): Promise<HomeState> {
  const offers = await prisma.userOffer.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, productName: true, commercial: true },
  });
  const hasOffer = offers.some((row) => row.productName.trim());

  let fathomCount = 0;
  let lastUnanalyzed: HomeState["lastUnanalyzed"] = null;
  let fathomConnected = false;
  let autoIngest = false;
  try {
    const connection = await prisma.fathomConnection.findUnique({
      where: { userId },
      select: { webhookId: true },
    });
    fathomConnected = Boolean(connection);
    autoIngest = Boolean(connection?.webhookId);
    fathomCount = await prisma.fathomRecording.count({
      where: {
        userId,
        AND: [
          { transcriptText: { not: "" } },
          { transcriptText: { not: EMPTY_TRANSCRIPT_MARK } },
        ],
      },
    });
    const pending = await prisma.fathomRecording.findFirst({
      where: {
        userId,
        practiceSessionId: null,
        AND: [
          { transcriptText: { not: "" } },
          { transcriptText: { not: EMPTY_TRANSCRIPT_MARK } },
        ],
      },
      orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
      select: { id: true, title: true, transcriptText: true },
    });
    if (pending && isUsableTranscript(pending.transcriptText)) {
      lastUnanalyzed = { id: pending.id, title: pending.title };
    }
  } catch {
    fathomCount = 0;
  }

  const uploadCount = await prisma.clientTranscript.count({ where: { userId } });
  const filed = await prisma.callRecord.count({
    where: {
      userId,
      source: { in: ["fathom", "upload", "qc"] },
    },
  });
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
