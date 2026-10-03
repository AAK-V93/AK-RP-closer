-- Foreign keys and the one index production does not have yet.
-- CallRecord_userId_fkey is migration 1. The 12 foreign keys already
-- validated in production, and CallRecord_userId_recordedAt_idx, stay in
-- 0_init. This file does not drop them.
--
-- CREATE INDEX CONCURRENTLY does not fit Prisma 6.16.3. migrate deploy sends
-- this whole file as one simple Query, and PostgreSQL runs every statement
-- up to the first COMMIT inside one implicit transaction. CONCURRENTLY cannot
-- run inside a transaction block, so the index is a plain
-- CREATE INDEX IF NOT EXISTS.
--
-- Each foreign key is added NOT VALID, committed, then validated in its own
-- step. DROP CONSTRAINT IF EXISTS makes a retry safe if an earlier VALIDATE
-- failed and left the NOT VALID constraint behind. It only names the six
-- keys this migration adds.
CREATE INDEX IF NOT EXISTS "LeadAlert_threadId_idx" ON "LeadAlert"("threadId");

COMMIT;

ALTER TABLE "ExtractorFeedback" DROP CONSTRAINT IF EXISTS "ExtractorFeedback_userId_fkey";
ALTER TABLE "ExtractorFeedback" ADD CONSTRAINT "ExtractorFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "ExtractorFeedback" VALIDATE CONSTRAINT "ExtractorFeedback_userId_fkey";

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

ALTER TABLE "PushSubscription" DROP CONSTRAINT IF EXISTS "PushSubscription_userId_fkey";
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

COMMIT;

ALTER TABLE "PushSubscription" VALIDATE CONSTRAINT "PushSubscription_userId_fkey";
