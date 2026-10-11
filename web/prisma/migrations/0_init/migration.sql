-- Closer Trainer v2: clean baseline for the new, empty database.
-- Generated with: prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- plus the two partial unique indexes at the end (not expressible in schema.prisma).

-- CreateEnum
CREATE TYPE "BackfillStatus" AS ENUM ('NONE', 'RUNNING', 'DONE', 'ERROR');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PER_CLOSE', 'PCT_SALE', 'PCT_CASH');

-- CreateEnum
CREATE TYPE "ScriptOrigin" AS ENUM ('EMPRESA', 'APP', 'PROPIO');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('SEGUIMIENTO', 'CERRADO', 'PERDIDO');

-- CreateEnum
CREATE TYPE "CallSource" AS ENUM ('FATHOM', 'UPLOAD');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('CERRO', 'SEGUIMIENTO', 'PERDIDO', 'REAGENDAR');

-- CreateEnum
CREATE TYPE "CallState" AS ENUM ('PROCESSING', 'PENDING_CONFIRM', 'CONFIRMED', 'IGNORED', 'BRIEF_FAILED');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('ESCRIBIR', 'LLAMAR', 'COBRAR', 'REUNION');

-- CreateEnum
CREATE TYPE "TaskOrigin" AS ENUM ('BRIEF', 'CHAT', 'MANUAL', 'CONFIRM');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "LeadEventType" AS ENUM ('CALL', 'ATTEMPT', 'STATUS', 'DEAL', 'NOTE', 'APPLIED_CHANGE');

-- CreateEnum
CREATE TYPE "AttemptResult" AS ENUM ('RESPONDIO', 'NO_CONTESTO', 'ENVIADO');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('WHATSAPP', 'LLAMADA', 'EMAIL', 'OTRO');

-- CreateEnum
CREATE TYPE "ChangeOrigin" AS ENUM ('CHAT', 'CONFIRM', 'BRIEF', 'RECONSTRUCTION', 'FICHA');

-- CreateEnum
CREATE TYPE "ChangeKind" AS ENUM ('CREATE_LEAD', 'UPDATE_LEAD', 'SET_STATUS', 'LOG_ATTEMPT', 'CREATE_TASK', 'CREATE_DEAL', 'SET_GOAL');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'UNDONE', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Bogota',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FathomConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "webhookId" TEXT,
    "webhookSecretEnc" TEXT,
    "webhookToken" TEXT,
    "importSince" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "backfillCursor" TEXT,
    "backfillStatus" "BackfillStatus" NOT NULL DEFAULT 'NONE',
    "backfillUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FathomConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceCash" DECIMAL(12,2),
    "installmentsCount" INTEGER,
    "installmentAmount" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "commissionType" "CommissionType",
    "commissionValue" DECIMAL(12,2),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "origin" "ScriptOrigin" NOT NULL,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "paidCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuccessCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "videoUrl" TEXT,
    "durationSec" INTEGER,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuccessCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNorm" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "offerId" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'SEGUIMIENTO',
    "oneLine" VARCHAR(140),
    "whereLeft" TEXT,
    "missing" TEXT,
    "decider" TEXT,
    "lastCallId" TEXT,
    "lastCallAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "nextContactAt" TIMESTAMP(3),
    "nextMeetingAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "attemptsSinceLastCall" INTEGER NOT NULL DEFAULT 0,
    "potentialCommission" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT,
    "offerId" TEXT,
    "source" "CallSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shareUrl" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER,
    "summaryEn" TEXT,
    "brief" JSONB,
    "briefVersion" INTEGER NOT NULL DEFAULT 0,
    "oneLine" VARCHAR(140),
    "suggestedOutcome" "CallOutcome",
    "outcome" "CallOutcome",
    "confirmedAt" TIMESTAMP(3),
    "state" "CallState" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallTranscript" (
    "callId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL,

    CONSTRAINT "CallTranscript_pkey" PRIMARY KEY ("callId")
);

-- CreateTable
CREATE TABLE "CallObjection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "leadId" TEXT,
    "offerId" TEXT,
    "label" TEXT NOT NULL,
    "quote" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallObjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dueAt" DATE NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "note" TEXT,
    "origin" "TaskOrigin" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "LeadEventType" NOT NULL,
    "attemptResult" "AttemptResult",
    "channel" "ContactChannel",
    "scriptId" TEXT,
    "callId" TEXT,
    "proposedChangeId" TEXT,
    "note" VARCHAR(300),

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposedChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT,
    "callId" TEXT,
    "origin" "ChangeOrigin" NOT NULL,
    "kind" "ChangeKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "preview" TEXT NOT NULL,
    "status" "ChangeStatus" NOT NULL DEFAULT 'PENDING',
    "undo" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ProposedChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMonthStats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "offerId" TEXT,
    "callsHeld" INTEGER NOT NULL DEFAULT 0,
    "closedCount" INTEGER NOT NULL DEFAULT 0,
    "lostCount" INTEGER NOT NULL DEFAULT 0,
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "salesTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commissionEarned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMonthStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCounters" (
    "userId" TEXT NOT NULL,
    "pendingConfirmCount" INTEGER NOT NULL DEFAULT 0,
    "followingCount" INTEGER NOT NULL DEFAULT 0,
    "lastCloseAt" TIMESTAMP(3),
    "lastCloseLeadName" TEXT,
    "callsSinceLastClose" INTEGER NOT NULL DEFAULT 0,
    "topObjectionLabel" TEXT,
    "topObjectionHits" INTEGER,
    "topObjectionOf" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCounters_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PracticeSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "callSection" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "outcomeSummary" TEXT NOT NULL DEFAULT '',
    "strengths" TEXT,
    "improve" TEXT,
    "tryLine" TEXT,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "evaluation" JSONB NOT NULL,
    "criterionScores" JSONB NOT NULL,
    "scored" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "FathomConnection_userId_key" ON "FathomConnection"("userId");

-- CreateIndex
CREATE INDEX "FathomConnection_webhookToken_idx" ON "FathomConnection"("webhookToken");

-- CreateIndex
CREATE INDEX "Offer_userId_archivedAt_idx" ON "Offer"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "Script_userId_offerId_idx" ON "Script"("userId", "offerId");

-- CreateIndex
CREATE INDEX "SuccessCase_userId_offerId_idx" ON "SuccessCase"("userId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_lastCallId_key" ON "Lead"("lastCallId");

-- CreateIndex
CREATE INDEX "Lead_userId_status_nextContactAt_idx" ON "Lead"("userId", "status", "nextContactAt");

-- CreateIndex
CREATE INDEX "Lead_userId_status_lastContactAt_idx" ON "Lead"("userId", "status", "lastContactAt" DESC);

-- CreateIndex
CREATE INDEX "Lead_userId_status_closedAt_idx" ON "Lead"("userId", "status", "closedAt");

-- CreateIndex
CREATE INDEX "Lead_userId_status_lostAt_idx" ON "Lead"("userId", "status", "lostAt");

-- CreateIndex
CREATE INDEX "Lead_userId_nameNorm_idx" ON "Lead"("userId", "nameNorm");

-- CreateIndex
CREATE INDEX "Call_userId_state_recordedAt_idx" ON "Call"("userId", "state", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "Call_leadId_recordedAt_idx" ON "Call"("leadId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "Call_userId_recordedAt_idx" ON "Call"("userId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Call_userId_source_sourceId_key" ON "Call"("userId", "source", "sourceId");

-- CreateIndex
CREATE INDEX "CallTranscript_userId_idx" ON "CallTranscript"("userId");

-- CreateIndex
CREATE INDEX "CallObjection_userId_at_idx" ON "CallObjection"("userId", "at");

-- CreateIndex
CREATE INDEX "FollowUpTask_userId_status_dueAt_idx" ON "FollowUpTask"("userId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "LeadEvent_leadId_type_at_idx" ON "LeadEvent"("leadId", "type", "at");

-- CreateIndex
CREATE INDEX "LeadEvent_userId_type_at_idx" ON "LeadEvent"("userId", "type", "at");

-- CreateIndex
CREATE UNIQUE INDEX "ProposedChange_idempotencyKey_key" ON "ProposedChange"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProposedChange_userId_status_createdAt_idx" ON "ProposedChange"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserMonthStats_userId_month_offerId_key" ON "UserMonthStats"("userId", "month", "offerId");

-- CreateIndex
CREATE INDEX "PracticeSession_userId_createdAt_idx" ON "PracticeSession"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "FathomConnection" ADD CONSTRAINT "FathomConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessCase" ADD CONSTRAINT "SuccessCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessCase" ADD CONSTRAINT "SuccessCase_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_lastCallId_fkey" FOREIGN KEY ("lastCallId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallTranscript" ADD CONSTRAINT "CallTranscript_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallTranscript" ADD CONSTRAINT "CallTranscript_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallObjection" ADD CONSTRAINT "CallObjection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallObjection" ADD CONSTRAINT "CallObjection_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallObjection" ADD CONSTRAINT "CallObjection_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallObjection" ADD CONSTRAINT "CallObjection_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_proposedChangeId_fkey" FOREIGN KEY ("proposedChangeId") REFERENCES "ProposedChange"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedChange" ADD CONSTRAINT "ProposedChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedChange" ADD CONSTRAINT "ProposedChange_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedChange" ADD CONSTRAINT "ProposedChange_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMonthStats" ADD CONSTRAINT "UserMonthStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMonthStats" ADD CONSTRAINT "UserMonthStats_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCounters" ADD CONSTRAINT "UserCounters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial unique indexes (not expressible in schema.prisma).
-- One OPEN follow-up task per lead (plan 1.1, FollowUpTask).
CREATE UNIQUE INDEX "FollowUpTask_leadId_open_key" ON "FollowUpTask"("leadId") WHERE "status" = 'OPEN';

-- One "all offers" row per user and month (plan 1.1, UserMonthStats with offerId NULL).
CREATE UNIQUE INDEX "UserMonthStats_userId_month_all_key" ON "UserMonthStats"("userId", "month") WHERE "offerId" IS NULL;
