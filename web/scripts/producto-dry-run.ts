/**
 * Lista cada lead cuyo producto no es una oferta guardada.
 * Por defecto no escribe. Kali tiene que confirmar antes de aplicar.
 *
 * Desde web/:
 *   npx tsx scripts/producto-dry-run.ts
 *   npx tsx scripts/producto-dry-run.ts --apply
 *
 * --apply hace un update por fila. Sin transacción, sin updateMany y sin escrituras anidadas.
 */
import { Prisma } from "@prisma/client";
import { parseCommercial } from "../src/lib/offer-commercial";
import { getPrisma } from "../src/lib/prisma";
import {
  planCallProductoRepair,
  planLeadProductoRepair,
  type OfferRef,
} from "../src/lib/producto-guard";

const apply = process.argv.includes("--apply");

function filingOf(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

async function main() {
  const prisma = getPrisma();
  if (!prisma) {
    console.error("No hay DATABASE_URL. No leí ni escribí nada.");
    process.exit(1);
  }
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  let listed = 0;
  for (const user of users) {
    const offerRows = await prisma.userOffer.findMany({
      where: { userId: user.id },
      select: { productName: true, commercial: true },
    });
    const offers: OfferRef[] = offerRows
      .filter((row) => row.productName)
      .map((row) => ({
        productName: row.productName,
        aliases: parseCommercial(row.commercial).aliases,
      }));
    const leads = await prisma.lead.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, offerName: true, nextStep: true, lastSummary: true },
    });
    for (const lead of leads) {
      const repair = planLeadProductoRepair(lead, offers);
      if (!repair) continue;
      listed += 1;
      console.log(
        [user.email || user.id, repair.leadName, repair.current, repair.proposal, "lead"].join("\t"),
      );
      if (!apply) continue;
      await prisma.lead.update({ where: { id: repair.id }, data: repair.data });
    }
    const calls = await prisma.callRecord.findMany({
      where: { userId: user.id },
      select: { id: true, leadName: true, offerName: true, filingJson: true },
    });
    for (const call of calls) {
      const filing = filingOf(call.filingJson);
      const repair = planCallProductoRepair(
        {
          id: call.id,
          leadName: call.leadName,
          offerName: call.offerName,
          producto: String(filing.producto || ""),
          acuerdo: String(filing.acuerdo_seguimiento || ""),
          notas: String(filing.notas_crm || ""),
        },
        offers,
      );
      if (!repair) continue;
      for (const row of repair.rows) {
        listed += 1;
        console.log(
          [user.email || user.id, row.leadName, row.current, row.proposal, "llamada"].join("\t"),
        );
      }
      if (!apply) continue;
      const next = filingOf(call.filingJson);
      next.producto = repair.producto;
      if (repair.acuerdo) next.acuerdo_seguimiento = repair.acuerdo;
      if (repair.notas) next.notas_crm = repair.notas;
      await prisma.callRecord.update({
        where: { id: repair.id },
        data: {
          offerName: repair.offerName,
          filingJson: next as Prisma.InputJsonValue,
        },
      });
    }
  }
  if (apply) {
    console.log(`Aplicado: ${listed} filas, un update por fila.`);
    return;
  }
  console.log(
    `Dry-run: ${listed} filas. No escribí nada. Para aplicar, después de confirmar: npx tsx scripts/producto-dry-run.ts --apply`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
