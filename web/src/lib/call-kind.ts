/** Calls that are not a live closer↔prospect sales meeting. */
export function normalizeEstadoAgenda(estado?: string | null) {
  const raw = String(estado || "").trim();
  if (!raw || raw.toLowerCase() === "null") return null;
  const folded = raw
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
  if (
    folded === "INTERNA" ||
    folded === "INTERNAL" ||
    folded === "COACHING" ||
    folded === "PRACTICA" ||
    folded === "PRACTICE" ||
    folded === "ROLEPLAY" ||
    folded === "ROLE_PLAY" ||
    /COACH|PRACTIC|ROLE.?PLAY|AUDITOR/.test(folded)
  ) {
    return "INTERNA";
  }
  if (
    folded === "NO_COMERCIAL" ||
    folded === "NOCOMERCIAL" ||
    folded === "NO_ES_COMERCIAL" ||
    folded === "PERSONAL" ||
    /NO.?COMERCIAL/.test(folded)
  ) {
    return "NO_COMERCIAL";
  }
  if (folded === "CIERRE_VENTA" || folded === "CIERRE") return "CIERRE VENTA";
  if (folded === "ACUERDO_SIN_PAGO") return "ACUERDO SIN PAGO";
  if (folded === "NO_SHOW") return "NO SHOW";
  const spaced = folded.replace(/_/g, " ");
  if (
    spaced === "SHOW" ||
    spaced === "REPROGRAMA" ||
    spaced === "AGENDADO" ||
    spaced === "NO SHOW" ||
    spaced === "CIERRE VENTA" ||
    spaced === "ACUERDO SIN PAGO"
  ) {
    return spaced;
  }
  return raw.toUpperCase();
}

export function isNonSalesCall(estado?: string | null) {
  const value = normalizeEstadoAgenda(estado);
  return value === "INTERNA" || value === "NO_COMERCIAL";
}

/** Spanish chips the closer taps. Empty when the words are not an agenda state. */
export function agendaFromCloserWords(text: string) {
  const folded = String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!folded) return "";
  if (/no asist|no show|no se present/.test(folded)) return "NO SHOW";
  if (/reprogram/.test(folded)) return "REPROGRAMA";
  if (/acuerd|acordo/.test(folded)) return "ACUERDO SIN PAGO";
  if (/\bcerr|\bcerro|cierre/.test(folded)) return "CIERRE VENTA";
  if (/\basist|se hizo|\bshow\b/.test(folded)) return "SHOW";
  return "";
}
