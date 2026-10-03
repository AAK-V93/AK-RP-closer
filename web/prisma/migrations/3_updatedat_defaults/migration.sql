-- Production has no database default on these updatedAt columns.
-- schema.prisma declares @default(now()) @updatedAt. This only sets the
-- default. It does not rewrite existing rows.
ALTER TABLE "FathomConnection" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "FollowupPack" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Lead" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "UserOffer" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
