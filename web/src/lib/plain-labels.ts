const STATUS_LABELS: Record<string, string> = {
  SHOW: "Show",
  "NO SHOW": "No show",
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
  COBRANZA: "Cobro",
  SEGUNDA_REUNION: "Segunda reunión",
  "SEGUNDA REUNION": "Segunda reunión",
  RETOMAR: "Retomar",
  REAGENDAR: "Reagendar",
  "PAGO PENDIENTE": "Pago pendiente",
  AGENDA_CHECK: "¿Se hizo?",
  ONBOARDING: "Bienvenida",
  HOY: "Hoy",
  VENCIDO: "Pendiente de hoy",
  "PRÓXIMO": "Próximo",
};

/** Screen label for an internal status or thread type. */
export function plainStatus(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  return STATUS_LABELS[raw] || STATUS_LABELS[raw.toUpperCase()] || raw.replaceAll("_", " ");
}
