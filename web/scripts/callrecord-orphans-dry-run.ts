/**
 * Cuenta filas de CallRecord cuyo userId no existe en User.
 * Solo lectura. No escribe, y --apply no está permitido.
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

  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n
    FROM "CallRecord" AS c
    WHERE NOT EXISTS (
      SELECT 1 FROM "User" AS u WHERE u."id" = c."userId"
    )
  `;
  const count = rows[0]?.n ?? BigInt(0);
  console.log(`callrecord_orphans\t${count.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
