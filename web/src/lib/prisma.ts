import { PrismaClient } from "@prisma/client";
import { PrismaNeonHTTP } from "@prisma/adapter-neon";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function stripEnvWrapper(raw: string) {
  return raw
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/^DATABASE_URL\s*=\s*/i, "")
    .replace(/^['"]|['"]$/g, "")
    .split(/[\r\n]/)[0]
    .trim();
}

function encodePostgresUrl(raw: string): string | undefined {
  const cleaned = stripEnvWrapper(raw);
  const match = cleaned.match(/postgres(?:ql)?:\/\/\S+/i);
  const candidate = match ? match[0].replace(/[;,]+$/, "") : cleaned;
  if (!candidate) return undefined;

  try {
    const parsed = new URL(candidate);
    parsed.searchParams.delete("channel_binding");
    if (!parsed.searchParams.has("sslmode")) {
      parsed.searchParams.set("sslmode", "require");
    }
    return parsed.toString();
  } catch {
    const parts = candidate.match(
      /^(postgres(?:ql)?:\/\/)([^:/?#]+):([^@]*)@([^/?#]+)(.*)$/i,
    );
    if (!parts) return undefined;
    const [, protocol, user, password, host, rest] = parts;
    try {
      const parsed = new URL(
        `${protocol}${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}${rest}`,
      );
      parsed.searchParams.delete("channel_binding");
      if (!parsed.searchParams.has("sslmode")) {
        parsed.searchParams.set("sslmode", "require");
      }
      return parsed.toString();
    } catch {
      return undefined;
    }
  }
}

export function getDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw?.trim()) return undefined;
  return encodePostgresUrl(raw);
}

export function describeDatabaseUrl() {
  const raw = process.env.DATABASE_URL ?? "";
  const cleaned = stripEnvWrapper(raw);
  const encoded = encodePostgresUrl(raw);
  let host: string | null = null;
  if (encoded) {
    try {
      host = new URL(encoded).host;
    } catch {
      host = null;
    }
  }
  return {
    hasDatabaseUrl: Boolean(raw.trim()),
    length: raw.trim().length,
    scheme: cleaned.split(":")[0]?.slice(0, 16) || null,
    hasWhitespace: /\s/.test(raw.trim()),
    parseOk: Boolean(encoded),
    host,
  };
}

export function isDatabaseConfigured() {
  return Boolean(getDatabaseUrl());
}

export function getPrisma(): PrismaClient | null {
  const url = getDatabaseUrl();
  if (!url) return null;
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaNeonHTTP(url, {
      arrayMode: false,
      fullResults: true,
    });
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.prisma;
}

export function prismaErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code != null && String(code).trim()) return String(code);
  }
  if (error instanceof Error) {
    const match = error.message.match(/\bP\d{4}\b/);
    if (match) return match[0];
    if (/not a valid URL/i.test(error.message)) return "BAD_URL";
    if (/transaction/i.test(error.message)) return "TX";
    if (/can't reach|ECONNREFUSED|ENOTFOUND|timeout/i.test(error.message)) {
      return "P1001";
    }
  }
  return "UNKNOWN";
}

let fathomTablesReady: Promise<void> | null = null;

export async function ensureFathomTables(prisma: PrismaClient) {
  if (!fathomTablesReady) {
    fathomTablesReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "FathomConnection" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "apiKeyEnc" TEXT NOT NULL,
          "lastSyncAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "FathomConnection_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "FathomConnection_userId_key" ON "FathomConnection"("userId")`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "FathomRecording" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "connectionId" TEXT NOT NULL,
          "fathomRecordingId" INTEGER NOT NULL,
          "title" TEXT NOT NULL,
          "shareUrl" TEXT NOT NULL DEFAULT '',
          "recordedAt" TIMESTAMP(3),
          "transcriptText" TEXT NOT NULL DEFAULT '',
          "transcriptJson" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "practiceSessionId" TEXT,
          CONSTRAINT "FathomRecording_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "FathomRecording_userId_fathomRecordingId_key" ON "FathomRecording"("userId", "fathomRecordingId")`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "FathomRecording_userId_recordedAt_idx" ON "FathomRecording"("userId", "recordedAt")`,
      );
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "FathomConnection"
          ADD CONSTRAINT "FathomConnection_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
      } catch {
        /* already exists */
      }
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "FathomRecording"
          ADD CONSTRAINT "FathomRecording_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
      } catch {
        /* already exists */
      }
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "FathomRecording"
          ADD CONSTRAINT "FathomRecording_connectionId_fkey"
          FOREIGN KEY ("connectionId") REFERENCES "FathomConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
      } catch {
        /* already exists */
      }
    })().catch((error) => {
      fathomTablesReady = null;
      throw error;
    });
  }
  return fathomTablesReady;
}
