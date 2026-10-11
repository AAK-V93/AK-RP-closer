-- PR 5 (ingesta): coach insights from the call brief, Fathom action items kept for a brief retry,
-- failed-brief counter, and the burst lease for the Fathom rebuild (no cron, no polling).
-- CreateEnum
CREATE TYPE "CoachInsightKind" AS ENUM ('BIEN', 'MEJORAR');

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "actionItemsEn" TEXT,
ADD COLUMN     "briefAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FathomConnection" ADD COLUMN     "backfillImported" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "backfillLockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CoachInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "kind" "CoachInsightKind" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "CoachInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachInsight_userId_createdAt_idx" ON "CoachInsight"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CoachInsight_userId_callId_idx" ON "CoachInsight"("userId", "callId");

-- AddForeignKey
ALTER TABLE "CoachInsight" ADD CONSTRAINT "CoachInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachInsight" ADD CONSTRAINT "CoachInsight_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
