-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "crmPrefs" JSONB NOT NULL DEFAULT '{}',
    "calendarRefreshEnc" TEXT NOT NULL DEFAULT '',
    "calendarSyncedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "niche" TEXT NOT NULL DEFAULT 'b2b-agencies-dfy',
    "notes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachMessage" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "thread" TEXT NOT NULL DEFAULT 'coach',
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachMessage_pkey" PRIMARY KEY ("id")
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
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "evaluation" JSONB NOT NULL,
    "criterionScores" JSONB NOT NULL,
    "scored" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FathomConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "importSince" TIMESTAMP(3),
    "webhookId" TEXT NOT NULL DEFAULT '',
    "webhookSecretEnc" TEXT NOT NULL DEFAULT '',
    "webhookToken" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FathomConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FathomRecording" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "fathomRecordingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shareUrl" TEXT NOT NULL DEFAULT '',
    "recordedAt" TIMESTAMP(3),
    "transcriptText" TEXT NOT NULL DEFAULT '',
    "transcriptJson" JSONB NOT NULL DEFAULT '[]',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "practiceSessionId" TEXT,

    CONSTRAINT "FathomRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOffer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL,
    "pitchSummary" TEXT NOT NULL DEFAULT '',
    "playbook" JSONB NOT NULL DEFAULT '{}',
    "commercial" JSONB NOT NULL DEFAULT '{}',
    "includeFathom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientTranscript" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "title" TEXT NOT NULL,
    "transcriptText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "callType" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL DEFAULT '',
    "leadName" TEXT NOT NULL DEFAULT '',
    "offerName" TEXT NOT NULL DEFAULT '',
    "trainsBot" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL DEFAULT '',
    "filingStatus" TEXT NOT NULL DEFAULT 'confirmed',
    "filingJson" JSONB NOT NULL DEFAULT '{}',
    "confirmedAt" TIMESTAMP(3),
    "practiceSessionId" TEXT,
    "estadoAgenda" TEXT NOT NULL DEFAULT '',
    "ventaTotal" DOUBLE PRECISION,
    "cashCollected" DOUBLE PRECISION,
    "saldoPendiente" DOUBLE PRECISION,
    "modoPago" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "offerName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'nuevo',
    "lastSummary" TEXT NOT NULL DEFAULT '',
    "nextStep" TEXT NOT NULL DEFAULT '',
    "nextStepAt" TIMESTAMP(3),
    "objections" TEXT NOT NULL DEFAULT '',
    "amountTalked" TEXT NOT NULL DEFAULT '',
    "amountPaid" TEXT NOT NULL DEFAULT '',
    "decider" TEXT NOT NULL DEFAULT '',
    "telefono" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "canalContacto" TEXT NOT NULL DEFAULT '',
    "calificado" BOOLEAN,
    "razonNoCierre" TEXT NOT NULL DEFAULT '',
    "etapaPerdida" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractorFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "callRecordId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valorExtraido" TEXT NOT NULL DEFAULT '',
    "valorCorregido" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractorFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enJuego" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "canal" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "mensajeSugerido" TEXT NOT NULL DEFAULT '',
    "contexto" TEXT NOT NULL DEFAULT '',
    "resultado" TEXT NOT NULL DEFAULT '',
    "resultadoNota" TEXT NOT NULL DEFAULT '',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "callRecordId" TEXT,
    "libraryScriptId" TEXT NOT NULL DEFAULT '',
    "threadId" TEXT,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "LeadAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowupThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL DEFAULT '',
    "tipo" TEXT NOT NULL,
    "secuenciaKey" TEXT NOT NULL,
    "pasoActual" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "askLost" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pagoAt" TIMESTAMP(3),
    "meetingAt" TIMESTAMP(3),
    "creadoDesdeCallRecordId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowupThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowupTouch" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canal" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "guionUsado" TEXT NOT NULL DEFAULT '',
    "libraryScriptId" TEXT NOT NULL DEFAULT '',
    "resultado" TEXT NOT NULL DEFAULT 'enviado',
    "notas" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "FollowupTouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT,
    "pctBase" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "umbralAcumuladoUsd" DOUBLE PRECISION NOT NULL DEFAULT 70000,
    "pctSobreUmbral" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "base" TEXT NOT NULL DEFAULT 'cash_collected',
    "periodoAcumulacion" TEXT NOT NULL DEFAULT 'mensual',

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT,
    "callRecordId" TEXT NOT NULL DEFAULT '',
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oferta" TEXT NOT NULL DEFAULT '',
    "venta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pctAplicado" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "generada" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cobrada" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fechaCobro" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowupPack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowupPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowupLibraryScript" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "intentosMin" INTEGER NOT NULL DEFAULT 0,
    "canal" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "recomendacion" TEXT NOT NULL DEFAULT '',
    "guion" TEXT NOT NULL,
    "asset" TEXT NOT NULL DEFAULT '',
    "uses" INTEGER NOT NULL DEFAULT 0,
    "hechos" INTEGER NOT NULL DEFAULT 0,
    "cierres" INTEGER NOT NULL DEFAULT 0,
    "perdidos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FollowupLibraryScript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowupStar" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowupStar_pkey" PRIMARY KEY ("id")
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CoachProfile_userId_key" ON "CoachProfile"("userId");

-- CreateIndex
CREATE INDEX "CoachMessage_profileId_createdAt_idx" ON "CoachMessage"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "CoachMessage_profileId_thread_createdAt_idx" ON "CoachMessage"("profileId", "thread", "createdAt");

-- CreateIndex
CREATE INDEX "PracticeSession_userId_createdAt_idx" ON "PracticeSession"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FathomConnection_userId_key" ON "FathomConnection"("userId");

-- CreateIndex
CREATE INDEX "FathomConnection_webhookToken_idx" ON "FathomConnection"("webhookToken");

-- CreateIndex
CREATE INDEX "FathomRecording_userId_recordedAt_idx" ON "FathomRecording"("userId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FathomRecording_userId_fathomRecordingId_key" ON "FathomRecording"("userId", "fathomRecordingId");

-- CreateIndex
CREATE INDEX "UserOffer_userId_updatedAt_idx" ON "UserOffer"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ClientTranscript_userId_createdAt_idx" ON "ClientTranscript"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientTranscript_offerId_idx" ON "ClientTranscript"("offerId");

-- CreateIndex
CREATE INDEX "CallRecord_userId_recordedAt_idx" ON "CallRecord"("userId", "recordedAt");

-- CreateIndex
CREATE INDEX "CallRecord_userId_estadoAgenda_idx" ON "CallRecord"("userId", "estadoAgenda");

-- CreateIndex
CREATE INDEX "CallRecord_userId_filingStatus_idx" ON "CallRecord"("userId", "filingStatus");

-- CreateIndex
CREATE INDEX "CallRecord_userId_filingStatus_recordedAt_idx" ON "CallRecord"("userId", "filingStatus", "recordedAt");

-- CreateIndex
CREATE INDEX "CallRecord_userId_filingStatus_confirmedAt_idx" ON "CallRecord"("userId", "filingStatus", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallRecord_userId_source_sourceId_key" ON "CallRecord"("userId", "source", "sourceId");

-- CreateIndex
CREATE INDEX "Lead_userId_updatedAt_idx" ON "Lead"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ExtractorFeedback_userId_createdAt_idx" ON "ExtractorFeedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ExtractorFeedback_userId_campo_idx" ON "ExtractorFeedback"("userId", "campo");

-- CreateIndex
CREATE INDEX "LeadAlert_userId_dueAt_idx" ON "LeadAlert"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "LeadAlert_userId_resolvedAt_idx" ON "LeadAlert"("userId", "resolvedAt");

-- CreateIndex
CREATE INDEX "LeadAlert_userId_resolvedAt_notifiedAt_idx" ON "LeadAlert"("userId", "resolvedAt", "notifiedAt");

-- CreateIndex
CREATE INDEX "LeadAlert_threadId_idx" ON "LeadAlert"("threadId");

-- CreateIndex
CREATE INDEX "FollowupThread_userId_estado_idx" ON "FollowupThread"("userId", "estado");

-- CreateIndex
CREATE INDEX "FollowupThread_leadId_estado_idx" ON "FollowupThread"("leadId", "estado");

-- CreateIndex
CREATE INDEX "FollowupTouch_threadId_fecha_idx" ON "FollowupTouch"("threadId", "fecha");

-- CreateIndex
CREATE INDEX "CommissionRule_userId_idx" ON "CommissionRule"("userId");

-- CreateIndex
CREATE INDEX "Commission_userId_fecha_idx" ON "Commission"("userId", "fecha");

-- CreateIndex
CREATE INDEX "FollowupPack_visibility_updatedAt_idx" ON "FollowupPack"("visibility", "updatedAt");

-- CreateIndex
CREATE INDEX "FollowupLibraryScript_packId_idx" ON "FollowupLibraryScript"("packId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowupStar_userId_packId_key" ON "FollowupStar"("userId", "packId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachMessage" ADD CONSTRAINT "CoachMessage_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FathomConnection" ADD CONSTRAINT "FathomConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FathomRecording" ADD CONSTRAINT "FathomRecording_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FathomRecording" ADD CONSTRAINT "FathomRecording_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "FathomConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOffer" ADD CONSTRAINT "UserOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTranscript" ADD CONSTRAINT "ClientTranscript_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTranscript" ADD CONSTRAINT "ClientTranscript_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "UserOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractorFeedback" ADD CONSTRAINT "ExtractorFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAlert" ADD CONSTRAINT "LeadAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAlert" ADD CONSTRAINT "LeadAlert_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAlert" ADD CONSTRAINT "LeadAlert_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "FollowupThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowupThread" ADD CONSTRAINT "FollowupThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowupThread" ADD CONSTRAINT "FollowupThread_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowupTouch" ADD CONSTRAINT "FollowupTouch_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "FollowupThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "UserOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowupPack" ADD CONSTRAINT "FollowupPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowupLibraryScript" ADD CONSTRAINT "FollowupLibraryScript_packId_fkey" FOREIGN KEY ("packId") REFERENCES "FollowupPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowupStar" ADD CONSTRAINT "FollowupStar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowupStar" ADD CONSTRAINT "FollowupStar_packId_fkey" FOREIGN KEY ("packId") REFERENCES "FollowupPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

