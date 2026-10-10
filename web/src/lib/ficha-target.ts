import type { PersonFacts } from "@/lib/person-facts";

/**
 * What a tap on a name sends to the ficha. Every surface builds one of these;
 * the ficha is the same sheet everywhere.
 */
export type FichaTarget = {
  name: string;
  leadId?: string;
  /** CallRecord id, or the Fathom/upload id Llamadas shows. */
  callId?: string;
  /** The open follow-up, so «Hecho» works from the ficha. */
  alertId?: string;
  /** Shown while the ficha loads (Inicio already has it). */
  initial?: { summary?: string; messages?: string[]; phone?: string; offer?: string; when?: string };
};

export function fichaUrl(target: FichaTarget) {
  const params = new URLSearchParams();
  if (target.leadId) params.set("leadId", target.leadId);
  if (target.callId) params.set("callId", target.callId);
  if (target.name) params.set("name", target.name);
  return `/api/crm/ficha?${params.toString()}`;
}

/** Inicio row → ficha. */
export function fichaFromInicio(row: {
  id: string;
  name: string;
  leadId?: string;
  agreement?: string;
  step?: string;
  messages?: string[];
  phone?: string;
  offer?: string;
  whenDate?: string;
}): FichaTarget {
  return {
    name: row.name,
    leadId: row.leadId || undefined,
    callId: row.id.startsWith("call:") ? row.id : undefined,
    alertId: row.id,
    initial: {
      summary: row.agreement || row.step || "",
      messages: row.messages || [],
      phone: row.phone || "",
      offer: row.offer || "",
      when: row.whenDate || "",
    },
  };
}

/** CRM board person (any tab) → ficha. */
export function fichaFromBoard(person: {
  id: string;
  name: string;
  leadId?: string;
  callId?: string;
  alertId?: string;
  offer?: string;
}): FichaTarget {
  return {
    name: person.name,
    leadId: person.leadId || undefined,
    callId: person.callId || undefined,
    alertId: person.alertId || undefined,
    initial: { offer: person.offer || "" },
  };
}

/** Llamadas history row (old calls too) → ficha. */
export function fichaFromCall(row: { id: string; leadName: string; callRecordId?: string; leadId?: string }): FichaTarget {
  return {
    name: row.leadName,
    leadId: row.leadId || undefined,
    callId: row.callRecordId || row.id,
  };
}

/** «Ver todo lo de la llamada», in the order the closer asked for. */
export function fichaDetailRows(facts: Pick<PersonFacts, "details">) {
  const d = facts.details;
  const money = [d.presupuesto ? `Hablaron de ${d.presupuesto}` : "", d.formaPago, d.pagado ? `Pagó ${d.pagado}` : "", d.saldo ? `Falta ${d.saldo}` : ""]
    .filter(Boolean)
    .join(" · ");
  return [
    { label: "Quién decide", values: [d.decisor].filter(Boolean) },
    { label: "Objeciones", values: [d.objeciones].filter(Boolean) },
    { label: "Presupuesto y forma de pago", values: [money].filter(Boolean) },
    { label: "Acuerdos", values: d.acuerdos },
    { label: "Razón de no cierre", values: [d.razonNoCierre].filter(Boolean) },
    { label: "Notas", values: d.notas },
  ];
}
