-- Indexes and foreign keys declared in schema.prisma that ensure* never
-- created. Kept out of 0_init so migrate resolve --applied 0_init does not
-- claim production already has them.
--
-- CREATE INDEX CONCURRENTLY does not fit Prisma 6.16.3. migrate deploy sends
-- this whole file as one simple Query, and PostgreSQL runs every statement
-- up to the first COMMIT inside one implicit transaction. CONCURRENTLY cannot
-- run inside a transaction block, so these indexes are plain
-- CREATE INDEX IF NOT EXISTS.
--
-- Each foreign key is added NOT VALID, committed, then validated in its own
-- step. DROP CONSTRAINT IF EXISTS makes a retry safe if an earlier VALIDATE
-- failed and left the NOT VALID constraint behind.
CREATE INDEX IF NOT EXISTS "CallRecord_userId_recordedAt_idx" ON "CallRecord"("userId", "recordedAt");
CREATE INDEX IF NOT EXISTS "LeadAlert_threadId_idx" ON "LeadAlert"("threadId");

COMMIT;

ALTER TABLE "ClientTranscript" DROP CONSTRAINT IF EXISTS "ClientTranscript_offerId_fkey";
ALTER TABLE "ClientTranscript" ADD CONSTRAINT "ClientTranscript_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "UserOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "ClientTranscript" VALIDATE CONSTRAINT "ClientTranscript_offerId_fkey";

COMMIT;

ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_userId_fkey";
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "Lead" VALIDATE CONSTRAINT "Lead_userId_fkey";

COMMIT;

ALTER TABLE "ExtractorFeedback" DROP CONSTRAINT IF EXISTS "ExtractorFeedback_userId_fkey";
ALTER TABLE "ExtractorFeedback" ADD CONSTRAINT "ExtractorFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "ExtractorFeedback" VALIDATE CONSTRAINT "ExtractorFeedback_userId_fkey";

COMMIT;

ALTER TABLE "LeadAlert" DROP CONSTRAINT IF EXISTS "LeadAlert_userId_fkey";
ALTER TABLE "LeadAlert" ADD CONSTRAINT "LeadAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "LeadAlert" VALIDATE CONSTRAINT "LeadAlert_userId_fkey";

COMMIT;

ALTER TABLE "LeadAlert" DROP CONSTRAINT IF EXISTS "LeadAlert_leadId_fkey";
ALTER TABLE "LeadAlert" ADD CONSTRAINT "LeadAlert_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "LeadAlert" VALIDATE CONSTRAINT "LeadAlert_leadId_fkey";

COMMIT;

ALTER TABLE "LeadAlert" DROP CONSTRAINT IF EXISTS "LeadAlert_threadId_fkey";
ALTER TABLE "LeadAlert" ADD CONSTRAINT "LeadAlert_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "FollowupThread"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "LeadAlert" VALIDATE CONSTRAINT "LeadAlert_threadId_fkey";

COMMIT;

ALTER TABLE "FollowupThread" DROP CONSTRAINT IF EXISTS "FollowupThread_userId_fkey";
ALTER TABLE "FollowupThread" ADD CONSTRAINT "FollowupThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "FollowupThread" VALIDATE CONSTRAINT "FollowupThread_userId_fkey";

COMMIT;

ALTER TABLE "FollowupThread" DROP CONSTRAINT IF EXISTS "FollowupThread_leadId_fkey";
ALTER TABLE "FollowupThread" ADD CONSTRAINT "FollowupThread_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "FollowupThread" VALIDATE CONSTRAINT "FollowupThread_leadId_fkey";

COMMIT;

ALTER TABLE "FollowupTouch" DROP CONSTRAINT IF EXISTS "FollowupTouch_threadId_fkey";
ALTER TABLE "FollowupTouch" ADD CONSTRAINT "FollowupTouch_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "FollowupThread"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "FollowupTouch" VALIDATE CONSTRAINT "FollowupTouch_threadId_fkey";

COMMIT;

ALTER TABLE "CommissionRule" DROP CONSTRAINT IF EXISTS "CommissionRule_userId_fkey";
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "CommissionRule" VALIDATE CONSTRAINT "CommissionRule_userId_fkey";

COMMIT;

ALTER TABLE "CommissionRule" DROP CONSTRAINT IF EXISTS "CommissionRule_offerId_fkey";
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "UserOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "CommissionRule" VALIDATE CONSTRAINT "CommissionRule_offerId_fkey";

COMMIT;

ALTER TABLE "Commission" DROP CONSTRAINT IF EXISTS "Commission_userId_fkey";
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "Commission" VALIDATE CONSTRAINT "Commission_userId_fkey";

COMMIT;

ALTER TABLE "Commission" DROP CONSTRAINT IF EXISTS "Commission_leadId_fkey";
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "Commission" VALIDATE CONSTRAINT "Commission_leadId_fkey";

COMMIT;

ALTER TABLE "FollowupPack" DROP CONSTRAINT IF EXISTS "FollowupPack_userId_fkey";
ALTER TABLE "FollowupPack" ADD CONSTRAINT "FollowupPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "FollowupPack" VALIDATE CONSTRAINT "FollowupPack_userId_fkey";

COMMIT;

ALTER TABLE "FollowupLibraryScript" DROP CONSTRAINT IF EXISTS "FollowupLibraryScript_packId_fkey";
ALTER TABLE "FollowupLibraryScript" ADD CONSTRAINT "FollowupLibraryScript_packId_fkey" FOREIGN KEY ("packId") REFERENCES "FollowupPack"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "FollowupLibraryScript" VALIDATE CONSTRAINT "FollowupLibraryScript_packId_fkey";

COMMIT;

ALTER TABLE "FollowupStar" DROP CONSTRAINT IF EXISTS "FollowupStar_userId_fkey";
ALTER TABLE "FollowupStar" ADD CONSTRAINT "FollowupStar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "FollowupStar" VALIDATE CONSTRAINT "FollowupStar_userId_fkey";

COMMIT;

ALTER TABLE "FollowupStar" DROP CONSTRAINT IF EXISTS "FollowupStar_packId_fkey";
ALTER TABLE "FollowupStar" ADD CONSTRAINT "FollowupStar_packId_fkey" FOREIGN KEY ("packId") REFERENCES "FollowupPack"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "FollowupStar" VALIDATE CONSTRAINT "FollowupStar_packId_fkey";

COMMIT;

ALTER TABLE "PushSubscription" DROP CONSTRAINT IF EXISTS "PushSubscription_userId_fkey";
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "PushSubscription" VALIDATE CONSTRAINT "PushSubscription_userId_fkey";
