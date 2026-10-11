-- PR 4, Metas: MonthlyGoal and WeeklyGoal (plan 1.1). Only new tables.
-- Goal history: one MonthlyGoal row per month, never deleted.

-- CreateTable
CREATE TABLE "MonthlyGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "targetCommission" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "chosenPath" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "meetingsTarget" INTEGER NOT NULL,
    "followupsTarget" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyGoal_userId_month_key" ON "MonthlyGoal"("userId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyGoal_userId_weekStart_key" ON "WeeklyGoal"("userId", "weekStart");

-- AddForeignKey
ALTER TABLE "MonthlyGoal" ADD CONSTRAINT "MonthlyGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyGoal" ADD CONSTRAINT "WeeklyGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sanity (Prisma does not model CHECK constraints; db:check ignores them)
ALTER TABLE "MonthlyGoal" ADD CONSTRAINT "MonthlyGoal_target_positive" CHECK ("targetCommission" > 0);
ALTER TABLE "WeeklyGoal" ADD CONSTRAINT "WeeklyGoal_targets_nonnegative" CHECK ("meetingsTarget" >= 0 AND "followupsTarget" >= 0);
