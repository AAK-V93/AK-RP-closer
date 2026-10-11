/**
 * Lista llamadas cuyo lead enlazado no coincide con el nombre completo del prospecto.
 * Solo lectura. No tiene --apply: Kali tiene que autorizar cualquier corrección.
 *
 * Desde web/, con DATABASE_URL (no hace falta escribir):
 *   npx tsx scripts/misfiled-calls-dry-run.ts
 */
import { getPrisma } from "../src/lib/prisma";
import { filingNamesFullyMatch } from "../src/lib/lead-match";

function filingOf(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as {
    lead_id?: unknown;
    cliente_real?: unknown;
    acuerdo_seguimiento?: unknown;
    notas_crm?: unknown;
  };
}

function prospectName(leadName: string | null, filing: ReturnType<typeof filingOf>) {
  return String(filing.cliente_real || leadName || "").trim();
}

async function main() {
  if (process.argv.includes("--apply")) {
    console.error("Este script es solo lectura. No existe --apply.");
    process.exit(1);
  }
  const prisma = getPrisma();
  if (!prisma) {
    console.error("No hay DATABASE_URL. No leí ni escribí nada.");
    process.exit(1);
  }
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  let listed = 0;
  for (const user of users) {
    const who = user.email || user.id;
    const leads = await prisma.lead.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, nextStep: true, lastSummary: true },
    });
    const byId = new Map(leads.map((lead) => [lead.id, lead]));
    const calls = await prisma.callRecord.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        leadName: true,
        recordedAt: true,
        filingStatus: true,
        filingJson: true,
      },
    });
    for (const call of calls) {
      const filing = filingOf(call.filingJson);
      const leadId = String(filing.lead_id || "").trim();
      const lead = leadId ? byId.get(leadId) : undefined;
      const prospect = prospectName(call.leadName, filing);
      if (!lead || !prospect) continue;
      if (filingNamesFullyMatch(lead.name, prospect)) continue;
      listed += 1;
      const when = call.recordedAt ? call.recordedAt.toISOString() : "";
      console.log(
        [
          who,
          call.id,
          when,
          call.filingStatus,
          prospect,
          lead.name,
          lead.id,
          String(filing.acuerdo_seguimiento || ""),
          lead.nextStep,
          String(filing.notas_crm || ""),
          lead.lastSummary,
        ].join("\t"),
      );
    }
  }
  console.log(
    `Dry-run: ${listed} llamadas cuyo lead no coincide con el nombre completo. No escribí nada.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
