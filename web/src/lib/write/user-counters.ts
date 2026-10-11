import type { PrismaClient } from "@prisma/client";

/**
 * Creates the empty UserCounters row for a new user (plan 4.2, step 1).
 * One statement, idempotent: safe on the Neon HTTP driver (no transaction)
 * and safe to call again for an existing user.
 */
export async function createUserCounters(
  prisma: Pick<PrismaClient, "$executeRaw">,
  userId: string,
) {
  await prisma.$executeRaw`
    INSERT INTO "UserCounters" ("userId", "updatedAt")
    VALUES (${userId}, now())
    ON CONFLICT ("userId") DO NOTHING
  `;
}
