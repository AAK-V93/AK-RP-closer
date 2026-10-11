-- v2 PR 3 (Mis ofertas): success-case sources and the extracted/user split.
-- SuccessCase had no writer before this migration, so it is empty; dropping
-- its old columns loses nothing. The check below stops the migration instead
-- of dropping data if that were ever not true.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SuccessCase") THEN
    RAISE EXCEPTION 'SuccessCase has rows; 1_ofertas expects it empty';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "CaseSourceKind" AS ENUM ('SHEET', 'YOUTUBE_PLAYLIST', 'YOUTUBE_CHANNEL', 'YOUTUBE_VIDEO');

-- CreateEnum
CREATE TYPE "CaseSourceAccess" AS ENUM ('PUBLIC_LINK', 'DRIVE_PICKER');

-- CreateEnum
CREATE TYPE "CaseSourceStatus" AS ENUM ('PENDING', 'READY', 'NEEDS_ACCESS', 'ERROR');

-- AlterTable
ALTER TABLE "SuccessCase" DROP COLUMN "after",
DROP COLUMN "before",
DROP COLUMN "name",
DROP COLUMN "profile",
DROP COLUMN "quote",
DROP COLUMN "videoUrl",
ADD COLUMN     "beforeExtracted" TEXT,
ADD COLUMN     "beforeUser" TEXT,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "dismissed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "externalKey" TEXT NOT NULL,
ADD COLUMN     "mediaUrlExtracted" TEXT,
ADD COLUMN     "mediaUrlUser" TEXT,
ADD COLUMN     "missingFromSourceAt" TIMESTAMP(3),
ADD COLUMN     "nameExtracted" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "nameUser" TEXT,
ADD COLUMN     "profileExtracted" TEXT,
ADD COLUMN     "profileUser" TEXT,
ADD COLUMN     "quoteExtracted" TEXT,
ADD COLUMN     "quoteUser" TEXT,
ADD COLUMN     "resultExtracted" TEXT,
ADD COLUMN     "resultUser" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceSnippet" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "GoogleDriveConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleDriveConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferCaseSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "rawUrl" TEXT NOT NULL,
    "kind" "CaseSourceKind" NOT NULL,
    "access" "CaseSourceAccess" NOT NULL DEFAULT 'PUBLIC_LINK',
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "contentHash" TEXT,
    "status" "CaseSourceStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferCaseSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDriveConnection_userId_key" ON "GoogleDriveConnection"("userId");

-- CreateIndex
CREATE INDEX "OfferCaseSource_userId_offerId_idx" ON "OfferCaseSource"("userId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferCaseSource_offerId_externalId_key" ON "OfferCaseSource"("offerId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SuccessCase_offerId_externalKey_key" ON "SuccessCase"("offerId", "externalKey");

-- AddForeignKey
ALTER TABLE "GoogleDriveConnection" ADD CONSTRAINT "GoogleDriveConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCaseSource" ADD CONSTRAINT "OfferCaseSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCaseSource" ADD CONSTRAINT "OfferCaseSource_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessCase" ADD CONSTRAINT "SuccessCase_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "OfferCaseSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

