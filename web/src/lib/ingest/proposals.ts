// Suggested changes from a brief (plan 2.7): ProposedChange rows the person
// confirms later. Pure: the write lives in lib/write/ingest.ts.
import type { CallBrief, Outcome } from "./brief";
import type { Invitee } from "./meeting";

export type Proposal = { kind: "CREATE_LEAD" | "UPDATE_LEAD" | "SET_STATUS"; leadId: string | null; payload: object; preview: string };

export function proposalsFor(
  brief: CallBrief,
  outcome: Outcome | null,
  invitees: Invitee[],
  matches: Array<{ id: string; name: string }>,
  offerId: string | null,
): Proposal[] {
  const guest = invitees[0] ?? null;
  const name = brief.cliente_real ?? guest?.name ?? null;
  const email = brief.email ?? guest?.email ?? null;
  const fields = {
    name,
    email,
    phone: brief.telefono,
    offerId,
    oneLine: brief.una_linea,
    whereLeft: brief.acuerdo_seguimiento,
    decider: brief.decisor.nombre ? [brief.decisor.nombre, brief.decisor.rol].filter(Boolean).join(" · ") : null,
  };
  const out: Proposal[] = [];
  const single = matches.length === 1 ? matches[0] : null;
  if (single) {
    out.push({ kind: "UPDATE_LEAD", leadId: single.id, payload: fields, preview: `Actualizar a ${single.name} con lo de esta llamada` });
  } else if (name) {
    out.push({
      kind: "CREATE_LEAD",
      leadId: null,
      payload: { ...fields, possibleMatches: matches.map((m) => m.id) },
      preview: matches.length ? `Crear a ${name} (o elegir a quién se parece)` : `Agregar a ${name} a tus personas`,
    });
  }
  const who = single?.name ?? name;
  if (who && (outcome === "CERRO" || outcome === "PERDIDO")) {
    out.push({
      kind: "SET_STATUS",
      leadId: single?.id ?? null,
      payload: { status: outcome === "CERRO" ? "CERRADO" : "PERDIDO", lostReason: outcome === "PERDIDO" ? brief.razon_no_cierre : null },
      preview: outcome === "CERRO" ? `Marcar a ${who} como venta cerrada` : `Marcar a ${who} como perdido`,
    });
  }
  return out;
}

