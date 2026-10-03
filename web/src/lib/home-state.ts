import type { PrismaClient } from "@prisma/client";
import { EMPTY_TRANSCRIPT_MARK } from "@/lib/fathom-import";
import { nextMissingCrmField } from "@/lib/offer-commercial";
import { retryRead } from "@/lib/read-retry";

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
  /** The offers query failed. This is not the same as having no offer. */
  offersUnreadable: boolean;
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
    prisma.$queryRaw<{ id: string; title: string }[]>`
      SELECT "id", "title"
      FROM "FathomRecording"
      WHERE "userId" = ${userId}
        AND "practiceSessionId" IS NULL
        AND char_length(btrim("transcriptText")) >= 80
        AND "transcriptText" <> ${EMPTY_TRANSCRIPT_MARK}
      ORDER BY "recordedAt" DESC NULLS LAST, "syncedAt" DESC
      LIMIT 1
    `,
  ]);
  const last = pending[0];
  return {
    fathomConnected: Boolean(connection),
    autoIngest: Boolean(connection?.webhookId),
    fathomCount,
    lastUnanalyzed: last ? { id: last.id, title: last.title } : null,
  };
}

export async function getHomeState(
  prisma: PrismaClient,
  userId: string,
): Promise<HomeState> {
  const [offerRead, fathom, uploadCount, filed] = await Promise.all([
    retryRead(
      "home offers",
      () =>
        prisma.userOffer.findMany({
          where: { userId },
          orderBy: { updatedAt: "desc" },
          select: { id: true, productName: true, commercial: true },
        }),
      (rows) => rows.length === 0,
    ).then(
      (rows) => ({ rows, unreadable: false as const }),
      (error) => {
        console.error("home offers failed", error);
        return { rows: [], unreadable: true as const };
      },
    ),
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
  const offers = offerRead.rows;
  const offersUnreadable = offerRead.unreadable;
  const hasOffer = offersUnreadable || offers.some((row) => row.productName.trim());
  const { fathomCount, lastUnanalyzed, fathomConnected, autoIngest } = fathom;
  const hasRealCalls = fathomCount > 0 || uploadCount > 0 || filed > 0;

  const phase: HomePhase = offersUnreadable
    ? hasRealCalls
      ? "c"
      : "b"
    : hasOffer && hasRealCalls
      ? "c"
      : hasOffer
        ? "b"
        : "a";
  const missingCrm = offersUnreadable
    ? null
    : nextMissingCrmField(
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
    offersUnreadable,
    lastUnanalyzed,
  };
}
