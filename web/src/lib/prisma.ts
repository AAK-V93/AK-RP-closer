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
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "FathomConnection" ADD COLUMN IF NOT EXISTS "importSince" TIMESTAMP(3)`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "FathomConnection" ADD COLUMN IF NOT EXISTS "webhookId" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "FathomConnection" ADD COLUMN IF NOT EXISTS "webhookSecretEnc" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "FathomConnection" ADD COLUMN IF NOT EXISTS "webhookToken" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "FathomConnection_webhookToken_idx" ON "FathomConnection"("webhookToken")`,
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

let workspaceTablesReady: Promise<void> | null = null;

export async function ensureWorkspaceTables(prisma: PrismaClient) {
  if (!workspaceTablesReady) {
    workspaceTablesReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "UserOffer" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "productName" TEXT NOT NULL,
          "productDescription" TEXT NOT NULL,
          "pitchSummary" TEXT NOT NULL DEFAULT '',
          "playbook" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "UserOffer_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `DROP INDEX IF EXISTS "UserOffer_userId_key"`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "UserOffer_userId_updatedAt_idx" ON "UserOffer"("userId", "updatedAt")`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "UserOffer" ADD COLUMN IF NOT EXISTS "includeFathom" BOOLEAN NOT NULL DEFAULT false`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "UserOffer" ADD COLUMN IF NOT EXISTS "commercial" JSONB NOT NULL DEFAULT '{}'::jsonb`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ClientTranscript" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "source" TEXT NOT NULL DEFAULT 'upload',
          "title" TEXT NOT NULL,
          "transcriptText" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ClientTranscript_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "ClientTranscript_userId_createdAt_idx" ON "ClientTranscript"("userId", "createdAt")`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "ClientTranscript" ADD COLUMN IF NOT EXISTS "offerId" TEXT`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "ClientTranscript_offerId_idx" ON "ClientTranscript"("offerId")`,
      );
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "UserOffer"
          ADD CONSTRAINT "UserOffer_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
      } catch {
        /* already exists */
      }
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "ClientTranscript"
          ADD CONSTRAINT "ClientTranscript_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
      } catch {
        /* already exists */
      }
    })().catch((error) => {
      workspaceTablesReady = null;
      throw error;
    });
  }
  return workspaceTablesReady;
}

let crmTablesReady: Promise<void> | null = null;

export async function ensureCrmTables(prisma: PrismaClient) {
  if (!crmTablesReady) {
    crmTablesReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CallRecord" (
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
          CONSTRAINT "CallRecord_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "CallRecord_userId_source_sourceId_key" ON "CallRecord"("userId", "source", "sourceId")`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "summary" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "filingStatus" TEXT NOT NULL DEFAULT 'confirmed'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "filingJson" JSONB NOT NULL DEFAULT '{}'::jsonb`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3)`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "practiceSessionId" TEXT`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "estadoAgenda" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "ventaTotal" DOUBLE PRECISION`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "cashCollected" DOUBLE PRECISION`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "saldoPendiente" DOUBLE PRECISION`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CallRecord" ADD COLUMN IF NOT EXISTS "modoPago" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "CallRecord_userId_estadoAgenda_idx" ON "CallRecord"("userId", "estadoAgenda")`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "Lead" (
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
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "Lead_userId_updatedAt_idx" ON "Lead"("userId", "updatedAt")`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "telefono" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "email" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "canalContacto" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "calificado" BOOLEAN`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "razonNoCierre" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "etapaPerdida" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "LeadAlert" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "leadId" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "question" TEXT NOT NULL,
          "dueAt" TIMESTAMP(3) NOT NULL,
          "resolvedAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "LeadAlert_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "LeadAlert_userId_dueAt_idx" ON "LeadAlert"("userId", "dueAt")`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "LeadAlert" ADD COLUMN IF NOT EXISTS "enJuego" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "LeadAlert" ADD COLUMN IF NOT EXISTS "canal" TEXT NOT NULL DEFAULT 'WHATSAPP'`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "LeadAlert" ADD COLUMN IF NOT EXISTS "mensajeSugerido" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "LeadAlert" ADD COLUMN IF NOT EXISTS "contexto" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "LeadAlert" ADD COLUMN IF NOT EXISTS "resultado" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "LeadAlert" ADD COLUMN IF NOT EXISTS "resultadoNota" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "LeadAlert" ADD COLUMN IF NOT EXISTS "intentos" INTEGER NOT NULL DEFAULT 0`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "LeadAlert" ADD COLUMN IF NOT EXISTS "callRecordId" TEXT`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "LeadAlert" ADD COLUMN IF NOT EXISTS "libraryScriptId" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "FollowupPack" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "description" TEXT NOT NULL DEFAULT '',
          "tags" TEXT NOT NULL DEFAULT '',
          "visibility" TEXT NOT NULL DEFAULT 'public',
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "FollowupPack_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "FollowupPack_visibility_updatedAt_idx" ON "FollowupPack"("visibility", "updatedAt")`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "FollowupLibraryScript" (
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
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "FollowupLibraryScript_packId_idx" ON "FollowupLibraryScript"("packId")`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "FollowupStar" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "packId" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "FollowupStar_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "FollowupStar_userId_packId_key" ON "FollowupStar"("userId", "packId")`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "crmPrefs" JSONB NOT NULL DEFAULT '{}'::jsonb`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "calendarRefreshEnc" TEXT NOT NULL DEFAULT ''`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "calendarSyncedAt" TIMESTAMP(3)`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CommissionRule" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "offerId" TEXT,
          "pctBase" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
          "umbralAcumuladoUsd" DOUBLE PRECISION NOT NULL DEFAULT 70000,
          "pctSobreUmbral" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
          "base" TEXT NOT NULL DEFAULT 'cash_collected',
          "periodoAcumulacion" TEXT NOT NULL DEFAULT 'mensual',
          CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "CommissionRule_userId_idx" ON "CommissionRule"("userId")`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "Commission" (
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
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "Commission_userId_fecha_idx" ON "Commission"("userId", "fecha")`,
      );
    })().catch((error) => {
      crmTablesReady = null;
      throw error;
    });
  }
  return crmTablesReady;
}

let coachTablesReady: Promise<void> | null = null;

export async function ensureCoachTables(prisma: PrismaClient) {
  if (!coachTablesReady) {
    coachTablesReady = (async () => {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "GuestFreePractice"`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CoachMessage" ADD COLUMN IF NOT EXISTS "thread" TEXT NOT NULL DEFAULT 'coach'`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "CoachMessage_profileId_thread_createdAt_idx" ON "CoachMessage"("profileId", "thread", "createdAt")`,
      );
    })().catch((error) => {
      coachTablesReady = null;
      throw error;
    });
  }
  return coachTablesReady;
}
