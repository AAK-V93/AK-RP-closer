const STATUS_LABELS: Record<string, string> = {
  SHOW: "Asistió",
  "NO SHOW": "No asistió",
  "CIERRE VENTA": "Cerró",
  "ACUERDO SIN PAGO": "Acuerdo sin pago",
  REPROGRAMA: "Reprogramó",
  AGENDADO: "Agendado",
  PENDIENTE: "Por cobrar",
  COBRADA: "Cobrada",
  CONFIRMED: "Confirmada",
  confirmed: "Confirmada",
  skipped: "Archivada",
  DECISION: "Decisión",
  YES: "—",
  TRUE: "—",
  COBRANZA: "Cobro",
  SEGUNDA_REUNION: "Segunda reunión",
  "SEGUNDA REUNION": "Segunda reunión",
  RETOMAR: "Retomar",
  REAGENDAR: "Reagendar",
  "PAGO PENDIENTE": "Pago pendiente",
  SEGUIMIENTO: "Seguimiento",
  POST_COBRANZA: "Después del cobro",
  PRE_COBRANZA: "Antes del cobro",
  VALIDACION: "Validación",
  EXPERIENCIA: "Experiencia",
  COBRO_VENCIDO: "Cobro vencido",
  COMISION: "Comisión",
  AGENDA_CHECK: "¿Se hizo?",
  ONBOARDING: "Bienvenida",
  HOY: "Hoy",
  VENCIDO: "Vencido",
  "PRÓXIMO": "Próximo",
  SI: "Sí",
  SÍ: "Sí",
  NO: "No",
  ZOOM: "Zoom",
  MEET: "Meet",
  WHATSAPP: "WhatsApp",
  LLAMADA: "Llamada",
  PRESENCIAL: "Presencial",
  EMAIL: "Correo",
  OTROS: "Otros",
  OTRO: "Otro",
};

const SMALL_WORDS = new Set(["de", "del", "la", "el", "los", "las", "y", "en"]);

function sentenceLabel(raw: string) {
  return raw
    .replaceAll("_", " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** Screen label for an internal status or thread type. */
export function plainStatus(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const known = STATUS_LABELS[raw] || STATUS_LABELS[raw.toUpperCase()];
  if (known) return known;
  if (raw === raw.toUpperCase()) return sentenceLabel(raw);
  return raw.replaceAll("_", " ");
}
