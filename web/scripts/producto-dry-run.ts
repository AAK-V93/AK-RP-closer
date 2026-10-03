/**
 * Lista cada lead cuyo producto no es una oferta guardada.
 * Por defecto no escribe. Kali tiene que confirmar antes de aplicar.
 *
 * Desde web/:
 *   npx tsx scripts/producto-dry-run.ts
 *   npx tsx scripts/producto-dry-run.ts --apply
 *
 * Un usuario sin ofertas guardadas se salta: no se lista ni se borra.
 * --apply hace un update por fila. Sin transacción, sin updateMany y sin escrituras anidadas.
 */
import { Prisma } from "@prisma/client";
import { parseCommercial } from "../src/lib/offer-commercial";
import { getPrisma } from "../src/lib/prisma";
import { planUserProductoDryRun, type OfferRef } from "../src/lib/producto-guard";

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
  let skipped = 0;
  for (const user of users) {
    const who = user.email || user.id;
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
    const calls = await prisma.callRecord.findMany({
      where: { userId: user.id },
      select: { id: true, leadName: true, offerName: true, filingJson: true },
    });
    const plan = planUserProductoDryRun({
      offers,
      leads,
      calls: calls.map((call) => {
        const filing = filingOf(call.filingJson);
        return {
          id: call.id,
          leadName: call.leadName,
          offerName: call.offerName,
          producto: String(filing.producto || ""),
          acuerdo: String(filing.acuerdo_seguimiento || ""),
          notas: String(filing.notas_crm || ""),
        };
      }),
    });
    if (plan.skipped) {
      skipped += 1;
      console.log(`${who}\t${plan.note}`);
      continue;
    }
    console.log(`${who}\tofertas: ${plan.offers.join(", ")}`);
    for (const line of plan.lines) {
      listed += 1;
      console.log(
        [who, line.leadName, line.current, line.action, line.proposal, line.source].join("\t"),
      );
    }
    if (!apply) continue;
    for (const repair of plan.leads) {
      await prisma.lead.update({ where: { id: repair.id }, data: repair.data });
    }
    for (const repair of plan.calls) {
      const call = calls.find((row) => row.id === repair.id);
      if (!call) continue;
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
    console.log(`Aplicado: ${listed} filas, un update por fila. Usuarios saltados: ${skipped}.`);
    return;
  }
  console.log(
    `Dry-run: ${listed} filas. Usuarios saltados (sin ofertas): ${skipped}. No escribí nada. Para aplicar, después de confirmar: npx tsx scripts/producto-dry-run.ts --apply`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
