import { plainStatus } from "@/lib/plain-labels";

/**
 * «Seguimiento 4 de 10» for a CRM sheet row, read from the stage map the CRM API sends
 * (built with the same helper as the ficha, see person-facts `stagesByLead`).
 * Empty for cerrados / perdidos or when the person is unknown.
 */
export function rowStage(
  stages: Record<string, string> | null | undefined,
  row: { leadId?: string | null; callId?: string | null },
) {
  if (!stages) return "";
  if (row.leadId && row.leadId in stages) return stages[row.leadId] || "";
  if (row.callId && `call:${row.callId}` in stages) return stages[`call:${row.callId}`] || "";
  return "";
}

export function operacionGlance(args: {
  fecha?: string | null;
  fechaProximo?: string | null;
  tipoSeguimiento?: string | null;
  /** Stage label from `rowStage` («Seguimiento 4 de 10»); empty = no stage. */
  etapa?: string | null;
  ultimoContacto?: string | null;
}) {
  const etapa = String(args.etapa || "").trim();
  const ultimoContacto = String(args.ultimoContacto || args.fecha || "").trim().slice(0, 16) || "—";
  const tipo = plainStatus(args.tipoSeguimiento);
  const when = String(args.fechaProximo || "").trim();
  const parts = [tipo !== "—" ? tipo : "", when].filter(Boolean);
  const siguiente = parts.length ? parts.join(" · ") : "Sin próximo paso";
  const line = [
    etapa,
    ultimoContacto !== "—" ? `Último contacto ${ultimoContacto}` : "",
    `Siguiente: ${siguiente}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { etapa, ultimoContacto, siguiente, line };
}
