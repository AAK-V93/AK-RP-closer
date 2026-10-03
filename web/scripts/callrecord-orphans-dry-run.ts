/**
 * Cuenta filas huérfanas de cada llave foránea que todavía no está en producción:
 * CallRecord.userId (migración 1) y las de 2_missing_constraints.
 * Solo lectura. No escribe, y --apply no está permitido.
 * Una columna nullable solo cuenta filas con valor que no existe en el padre.
 *
 * Desde web/, con DATABASE_URL de la base que se va a mirar:
 *   npx tsx scripts/callrecord-orphans-dry-run.ts
 */
import { getPrisma } from "../src/lib/prisma";

async function main() {
  if (process.argv.includes("--apply")) {
    console.error("Este script no escribe. Quita --apply. No leí nada.");
    process.exit(1);
  }

  const prisma = getPrisma();
  if (!prisma) {
    console.error("No hay DATABASE_URL. No leí ni escribí nada.");
    process.exit(1);
  }

  const rows = await prisma.$queryRaw<Array<Record<string, bigint>>>`
    SELECT
      (SELECT COUNT(*)::bigint FROM "CallRecord" c WHERE NOT EXISTS (SELECT 1 FROM "User" p WHERE p."id" = c."userId")) AS "CallRecord.userId",
      (SELECT COUNT(*)::bigint FROM "ClientTranscript" c WHERE c."offerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "UserOffer" p WHERE p."id" = c."offerId")) AS "ClientTranscript.offerId",
      (SELECT COUNT(*)::bigint FROM "Lead" c WHERE NOT EXISTS (SELECT 1 FROM "User" p WHERE p."id" = c."userId")) AS "Lead.userId",
      (SELECT COUNT(*)::bigint FROM "ExtractorFeedback" c WHERE NOT EXISTS (SELECT 1 FROM "User" p WHERE p."id" = c."userId")) AS "ExtractorFeedback.userId",
      (SELECT COUNT(*)::bigint FROM "LeadAlert" c WHERE NOT EXISTS (SELECT 1 FROM "User" p WHERE p."id" = c."userId")) AS "LeadAlert.userId",
      (SELECT COUNT(*)::bigint FROM "LeadAlert" c WHERE NOT EXISTS (SELECT 1 FROM "Lead" p WHERE p."id" = c."leadId")) AS "LeadAlert.leadId",
      (SELECT COUNT(*)::bigint FROM "LeadAlert" c WHERE c."threadId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "FollowupThread" p WHERE p."id" = c."threadId")) AS "LeadAlert.threadId",
      (SELECT COUNT(*)::bigint FROM "FollowupThread" c WHERE NOT EXISTS (SELECT 1 FROM "User" p WHERE p."id" = c."userId")) AS "FollowupThread.userId",
      (SELECT COUNT(*)::bigint FROM "FollowupThread" c WHERE NOT EXISTS (SELECT 1 FROM "Lead" p WHERE p."id" = c."leadId")) AS "FollowupThread.leadId",
      (SELECT COUNT(*)::bigint FROM "FollowupTouch" c WHERE NOT EXISTS (SELECT 1 FROM "FollowupThread" p WHERE p."id" = c."threadId")) AS "FollowupTouch.threadId",
      (SELECT COUNT(*)::bigint FROM "CommissionRule" c WHERE NOT EXISTS (SELECT 1 FROM "User" p WHERE p."id" = c."userId")) AS "CommissionRule.userId",
      (SELECT COUNT(*)::bigint FROM "CommissionRule" c WHERE c."offerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "UserOffer" p WHERE p."id" = c."offerId")) AS "CommissionRule.offerId",
      (SELECT COUNT(*)::bigint FROM "Commission" c WHERE NOT EXISTS (SELECT 1 FROM "User" p WHERE p."id" = c."userId")) AS "Commission.userId",
      (SELECT COUNT(*)::bigint FROM "Commission" c WHERE c."leadId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Lead" p WHERE p."id" = c."leadId")) AS "Commission.leadId",
      (SELECT COUNT(*)::bigint FROM "FollowupPack" c WHERE NOT EXISTS (SELECT 1 FROM "User" p WHERE p."id" = c."userId")) AS "FollowupPack.userId",
      (SELECT COUNT(*)::bigint FROM "FollowupLibraryScript" c WHERE NOT EXISTS (SELECT 1 FROM "FollowupPack" p WHERE p."id" = c."packId")) AS "FollowupLibraryScript.packId",
      (SELECT COUNT(*)::bigint FROM "FollowupStar" c WHERE NOT EXISTS (SELECT 1 FROM "User" p WHERE p."id" = c."userId")) AS "FollowupStar.userId",
      (SELECT COUNT(*)::bigint FROM "FollowupStar" c WHERE NOT EXISTS (SELECT 1 FROM "FollowupPack" p WHERE p."id" = c."packId")) AS "FollowupStar.packId",
      (SELECT COUNT(*)::bigint FROM "PushSubscription" c WHERE NOT EXISTS (SELECT 1 FROM "User" p WHERE p."id" = c."userId")) AS "PushSubscription.userId"
  `;
  const row = rows[0] ?? {};
  let total = BigInt(0);
  for (const [name, count] of Object.entries(row)) {
    const n = count ?? BigInt(0);
    total += typeof n === "bigint" ? n : BigInt(n);
    console.log(`${name}\t${n.toString()}`);
  }
  console.log(`orphans_total\t${total.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
