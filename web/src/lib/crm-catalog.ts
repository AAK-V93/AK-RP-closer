export const RAZONES_NO_CIERRE = [
  "Precio / No tiene dinero",
  "No era el momento",
  "Necesita consultarlo con alguien",
  "No confía / Necesita más información",
  "Ya compró con otra persona",
  "No show / No se presentó",
  "Otro",
] as const;

export const ETAPAS_PERDIDAS = [
  "Descubrimiento",
  "Presentación",
  "Objeciones",
  "Cierre",
  "Reserva",
] as const;

export const ESTADOS_AGENDA = [
  "AGENDADO",
  "SHOW",
  "CIERRE VENTA",
  "ACUERDO SIN PAGO",
  "REPROGRAMA",
  "NO SHOW",
] as const;

export const TIPOS_SEGUIMIENTO = [
  "SEGUNDA REUNION",
  "ONBOARDING",
  "VALIDACION",
  "EXPERIENCIA",
  "PRE_COBRANZA",
  "PAGO PENDIENTE",
  "COBRO_VENCIDO",
  "POST_COBRANZA",
  "DECISION",
  "RETOMAR",
  "REAGENDAR",
  "OTRO",
  "COMISION",
] as const;

export const CANALES_CONTACTO = [
  "ZOOM",
  "MEET",
  "WHATSAPP",
  "LLAMADA",
  "PRESENCIAL",
] as const;

export const CANALES_SEGUIMIENTO = ["WHATSAPP", "LLAMADA", "EMAIL"] as const;

export type RazonNoCierre = (typeof RAZONES_NO_CIERRE)[number];
export type EtapaPerdida = (typeof ETAPAS_PERDIDAS)[number];
export type EstadoAgenda = (typeof ESTADOS_AGENDA)[number];
export type TipoSeguimiento = (typeof TIPOS_SEGUIMIENTO)[number];
