// Drive connection for the Picker (drive.file). Its own refresh token,
// encrypted; Calendar's token is never read or written here.
import type { PrismaClient } from "@prisma/client";
import { WRITE_EFFECTS } from "@/lib/read/tags";
import { encryptSecret } from "@/lib/secret-crypto";
import { invalidate } from "./invalidate";
import type { WriteOpts } from "./offers";

export async function saveDriveConnection(
  db: PrismaClient,
  userId: string,
  token: { refreshToken: string; scope: string },
  opts: WriteOpts = {},
) {
  const refreshTokenEnc = encryptSecret(token.refreshToken);
  // one statement (no Prisma upsert emulation on Neon HTTP)
  await db.$executeRaw`
    INSERT INTO "GoogleDriveConnection" ("id", "userId", "refreshTokenEnc", "scope", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${userId}, ${refreshTokenEnc}, ${token.scope}, now(), now())
    ON CONFLICT ("userId") DO UPDATE SET "refreshTokenEnc" = EXCLUDED."refreshTokenEnc", "scope" = EXCLUDED."scope", "updatedAt" = now()
  `;
  invalidate(userId, WRITE_EFFECTS.saveDriveConnection(), opts.revalidate);
  return { ok: true as const };
}
