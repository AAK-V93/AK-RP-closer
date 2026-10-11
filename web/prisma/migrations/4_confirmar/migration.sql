-- PR 6 (confirmar): Deal (sale with frozen commission), CONFIRM_CALL changes with undo,
-- the task a change created (for «Deshacer»), the count of calls set aside as internal,
-- compensating UNDO events (LeadEvent.undoneAt / undoneByEventId: nothing is deleted)
-- and «Reagendar · sin fecha» (Lead.needsMeetingDate).
-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('ACTIVO', 'ANULADO');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CONTADO', 'CUOTAS');

-- AlterEnum
ALTER TYPE "ChangeKind" ADD VALUE 'CONFIRM_CALL';

-- AlterEnum
ALTER TYPE "LeadEventType" ADD VALUE 'UNDO';

-- AlterTable
ALTER TABLE "FollowUpTask" ADD COLUMN     "proposedChangeId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "needsMeetingDate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LeadEvent" ADD COLUMN     "undoneAt" TIMESTAMP(3),
ADD COLUMN     "undoneByEventId" TEXT;

-- AlterTable
ALTER TABLE "UserCounters" ADD COLUMN     "ignoredCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "offerId" TEXT,
    "callId" TEXT,
    "proposedChangeId" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "amountTotal" DECIMAL(12,2),
    "paymentMode" "PaymentMode",
    "cashCollected" DECIMAL(12,2),
    "commissionAmount" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'ACTIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deal_userId_closedAt_idx" ON "Deal"("userId", "closedAt");

-- CreateIndex
CREATE INDEX "Deal_leadId_idx" ON "Deal"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_userId_proposedChangeId_key" ON "Deal"("userId", "proposedChangeId");

-- CreateIndex
CREATE INDEX "FollowUpTask_leadId_proposedChangeId_idx" ON "FollowUpTask"("leadId", "proposedChangeId");

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_undoneByEventId_fkey" FOREIGN KEY ("undoneByEventId") REFERENCES "LeadEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_proposedChangeId_fkey" FOREIGN KEY ("proposedChangeId") REFERENCES "ProposedChange"("id") ON DELETE SET NULL ON UPDATE CASCADE;

