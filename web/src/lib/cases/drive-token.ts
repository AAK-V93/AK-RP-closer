// Short-lived Drive access token from the stored drive.file refresh token.
import type { PrismaClient } from "@prisma/client";
import { decryptSecret } from "@/lib/secret-crypto";
import { driveAccessToken, driveConfigured } from "./drive";

export async function driveTokenFor(db: PrismaClient, userId: string): Promise<string | null> {
  if (!driveConfigured()) return null;
  const conn = await db.googleDriveConnection.findUnique({ where: { userId }, select: { refreshTokenEnc: true } });
  if (!conn) return null;
  try {
    return await driveAccessToken(decryptSecret(conn.refreshTokenEnc));
  } catch {
    return null;
  }
}
