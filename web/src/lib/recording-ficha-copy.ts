/** Words of the old-call ficha. Plain Spanish, nothing invented. */
export const NOT_IN_CRM_NOTE = "Esta persona todavía no está en tu CRM, así que no tengo lo que quedó en la llamada.";
export const RECORDING_EMPTY_VALUE = "No quedó claro en la llamada";
export const ADD_TO_CRM_TITLE = "Agregar al CRM";

export function addToCrmProposal(name: string) {
  const who = String(name || "").trim() || "esta persona";
  return `Agregar a ${who} al CRM con lo de esta llamada. No se guarda nada hasta que toques «Guardar».`;
}

export function addToCrmResult(name: string, result: { filingStatus?: string; question?: string; already?: boolean }) {
  const who = String(name || "").trim() || "Esta persona";
  if (result.already) return `${who} ya estaba en tus llamadas guardadas.`;
  if (result.filingStatus === "confirmed") return `Listo: ${who} está en tu CRM.`;
  if (result.filingStatus === "pending") {
    return result.question
      ? `Guardé la llamada. Falta un dato en Llamadas › Por confirmar: ${result.question}`
      : "Guardé la llamada. Falta confirmarla en Llamadas › Por confirmar.";
  }
  if (result.filingStatus === "skipped") return "No la agregué: no parece una llamada de ventas.";
  return "Guardé la llamada.";
}
