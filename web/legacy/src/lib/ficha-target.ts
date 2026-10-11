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
  /** Day (YYYY-MM-DD) of the call it was opened from, so an old call still shows in the history. */
  day?: string;
  /** Shown while the ficha loads (Inicio already has it). */
  initial?: { summary?: string; messages?: string[]; phone?: string; offer?: string; when?: string };
};

export function fichaUrl(target: FichaTarget) {
  const params = new URLSearchParams();
  if (target.leadId) params.set("leadId", target.leadId);
  if (target.callId) params.set("callId", target.callId);
  if (target.name) params.set("name", target.name);
  if (target.day && /^\d{4}-\d{2}-\d{2}$/.test(target.day)) params.set("day", target.day);
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
  day?: string;
}): FichaTarget {
  return {
    ...(person.day ? { day: person.day } : {}),
    name: person.name,
    leadId: person.leadId || undefined,
    callId: person.callId || undefined,
    alertId: person.alertId || undefined,
    initial: { offer: person.offer || "" },
  };
}

/** Llamadas history row (old calls too) → ficha. */
export function fichaFromCall(row: {
  id: string;
  leadName: string;
  callRecordId?: string;
  leadId?: string;
  /** ISO date or day of the recording. */
  date?: string | null;
}): FichaTarget {
  const day = String(row.date || "").slice(0, 10);
  return {
    name: row.leadName,
    leadId: row.leadId || undefined,
    callId: row.callRecordId || row.id,
    day: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined,
  };
}

/** «Ver todas las columnas» → Operación row (one call). */
export function fichaFromOperacion(row: { id: string; cliente: string; leadId?: string; oferta?: string; producto?: string }): FichaTarget {
  return {
    name: row.cliente,
    leadId: row.leadId || undefined,
    callId: row.id || undefined,
    initial: { offer: row.producto || row.oferta || "" },
  };
}

/** «Ver todas las columnas» → Seguimientos row (an open follow-up). */
export function fichaFromFollowup(row: { id: string; cliente: string; leadId?: string; callId?: string; tipo?: string; oferta?: string }): FichaTarget {
  return {
    name: row.cliente,
    leadId: row.leadId || undefined,
    callId: row.callId || undefined,
    alertId: row.tipo === "AGENDA_CHECK" ? undefined : row.id,
    initial: { offer: row.oferta || "" },
  };
}

/** «Ver todas las columnas» → Comisiones row. */
export function fichaFromCommission(row: { cliente?: string; leadId?: string; oferta?: string }): FichaTarget | null {
  const name = String(row.cliente || "").trim();
  if (!name) return null;
  return { name, leadId: row.leadId || undefined, initial: { offer: row.oferta || "" } };
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
