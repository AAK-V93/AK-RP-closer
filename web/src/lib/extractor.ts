import { generateGeminiJson } from "@/lib/gemini";
import type { OfferForCrm } from "@/lib/offer-commercial";
import { RAZONES_NO_CIERRE, ETAPAS_PERDIDAS } from "@/lib/crm-catalog";
import { isNonSalesCall, normalizeEstadoAgenda } from "@/lib/call-kind";
import { inferFollowupDate } from "@/lib/followup-date";
import { followupIsClosed } from "@/lib/crm-followups";
import { normalizeImportedFiling } from "@/lib/call-normalize";
import { fillStatedDeal } from "@/lib/stated-deal";
import { labelCrmProse, spanishAgendaInText } from "@/lib/plain-labels";
import { PROTOCOLO_EXTRACTOR_COMERCIAL_PAE } from "@/lib/protocolo-extractor-comercial-pae";

export type ExtractorEvidencia = {
  identidad: string | null;
  cierre: string | null;
  venta_total: string | null;
  cash_collected: string | null;
  modo_pago: string | null;
  seguimiento: string | null;
};

export type ExtractorConfianza = {
  cliente_real: number;
  estado_agenda: number;
  producto: number;
  venta_total: number;
  cash_collected: number;
  modo_pago: number;
  requiere_seguimiento: number;
  tipo_seguimiento: number;
  proximo_seguimiento: number;
  acuerdo_seguimiento: number;
};

export type ExtractorJson = {
  cliente_real: string | null;
  estado_agenda: string | null;
  producto: string | null;
  venta_total: number | null;
  cash_collected: number | null;
  saldo_pendiente: number | null;
  modo_pago: string | null;
  requiere_seguimiento: boolean | null;
  tipo_seguimiento: string | null;
  proximo_seguimiento: string | null;
  acuerdo_seguimiento: string | null;
  notas_crm: string | null;
  evidencia: ExtractorEvidencia;
  confianza: ExtractorConfianza;
  requiere_revision_humana: boolean;
  motivo_revision: string | null;
  calificado: boolean | null;
  razon_no_cierre: string | null;
  etapa_perdida: string | null;
  canal_contacto: string | null;
  telefono: string | null;
  email: string | null;
  /** Closer marked this próximo seguimiento done, missed, or lost. */
  seguimiento_resultado: string | null;
  /** Previous próximo, kept so Hecho can be reopened. */
  seguimiento_cerrado: string | null;
  seguimiento_intentos: number | null;
  seguimiento_undo: unknown;
};

export function emptyExtractor(): ExtractorJson {
  return {
    cliente_real: null,
    estado_agenda: null,
    producto: null,
    venta_total: null,
    cash_collected: null,
    saldo_pendiente: null,
    modo_pago: null,
    requiere_seguimiento: null,
    tipo_seguimiento: null,
    proximo_seguimiento: null,
    acuerdo_seguimiento: null,
    notas_crm: null,
    evidencia: {
      identidad: null,
      cierre: null,
      venta_total: null,
      cash_collected: null,
      modo_pago: null,
      seguimiento: null,
    },
    confianza: {
      cliente_real: 0,
      estado_agenda: 0,
      producto: 0,
      venta_total: 0,
      cash_collected: 0,
      modo_pago: 0,
      requiere_seguimiento: 0,
      tipo_seguimiento: 0,
      proximo_seguimiento: 0,
      acuerdo_seguimiento: 0,
    },
    requiere_revision_humana: false,
    motivo_revision: null,
    calificado: null,
    razon_no_cierre: null,
    etapa_perdida: null,
    canal_contacto: null,
    telefono: null,
    email: null,
    seguimiento_resultado: null,
    seguimiento_cerrado: null,
    seguimiento_intentos: null,
    seguimiento_undo: null,
  };
}

export function isExtractorJson(raw: unknown): raw is ExtractorJson {
  if (!raw || typeof raw !== "object") return false;
  const row = raw as Record<string, unknown>;
  return "estado_agenda" in row || "cliente_real" in row;
}

const PAE_PRODUCT_LIST =
  /MILLONARIOS 360\r?\nINGRESOS 360\r?\nDESPEGA TU NEGOCIO\r?\nCOACHING\r?\nMENTORIAS\r?\nGIRAS\r?\nOTROS/;

const PAE_PAYMENT_LIST =
  /CONTADO\r?\n4 CUOTAS\r?\n6 CUOTAS\r?\n8 CUOTAS\r?\n12 CUOTAS\r?\nRESERVA/;

/** Separador. Todo lo que está antes es el protocolo PAE; lo de después es de la app. */
export const PAE_APPENDIX_MARKER = [
  "==================================================",
  "APÉNDICE DE LA APP — FUERA DEL PROTOCOLO PAE",
  "==================================================",
].join("\n");

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function paeProductLines(offers: OfferForCrm[]) {
  return offers
    .map((offer) => {
      const name = oneLine(offer.productName);
      if (!name) return "";
      const aliases = offer.commercial.aliases.map(oneLine).filter(Boolean);
      return aliases.length ? `${name} (alias: ${aliases.join(", ")})` : name;
    })
    .filter(Boolean);
}

export function paePaymentLines(offers: OfferForCrm[]) {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const offer of offers) {
    for (const mode of offer.commercial.paymentModes) {
      const name = oneLine(mode.name);
      if (!name) continue;
      const details = oneLine(mode.details);
      const line = details ? `${name} — ${details}` : name;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}

function replacePaeList(protocol: string, pattern: RegExp, lines: string[]) {
  const match = protocol.match(pattern);
  if (!match || match.index == null) {
    throw new Error("El protocolo PAE no contiene el bloque que hay que sustituir.");
  }
  const newline = match[0].includes("\r\n") ? "\r\n" : "\n";
  return (
    protocol.slice(0, match.index) +
    lines.join(newline) +
    protocol.slice(match.index + match[0].length)
  );
}

/** Protocolo PAE literal. Solo cambia la lista de productos y la de modos de pago. */
export function renderPaeProtocol(offers: OfferForCrm[]) {
  const withProducts = replacePaeList(
    PROTOCOLO_EXTRACTOR_COMERCIAL_PAE,
    PAE_PRODUCT_LIST,
    paeProductLines(offers),
  );
  return replacePaeList(withProducts, PAE_PAYMENT_LIST, paePaymentLines(offers));
}

export function buildExtractorPrompt(args: {
  offers: OfferForCrm[];
  title: string;
  fechaLlamada: string | null;
  transcript: string;
  readyCrm: boolean;
  hints?: string | null;
}) {
  const protocol = renderPaeProtocol(args.offers);
  const products = paeProductLines(args.offers);
  const payments = paePaymentLines(args.offers);
  const hints = args.hints?.trim();
  const appendix = [
    PAE_APPENDIX_MARKER,
    "Lo anterior es el protocolo PAE completo.",
    "Esta sección no forma parte de ese documento y no modifica sus secciones.",
    "Normalización, segunda pasada, confianza y el principio de nunca inventar quedan como están en el PAE.",
    "",
    "ESTADOS DE AGENDA ADICIONALES",
    "Además de SHOW, CIERRE VENTA, REPROGRAMA y NO SHOW:",
    "",
    "AGENDADO",
    "La llamada todavía no ocurre. Solo si el texto es una agenda futura, no una llamada ya hecha.",
    "",
    "ACUERDO SIN PAGO",
    "Acuerdo definitivo (producto, precio y modo) pero el pago se hará fuera de la llamada. No es CIERRE VENTA.",
    "",
    "INTERNA",
    "Coaching, práctica, roleplay, auditoría de llamadas, junta de equipo o directivos, feedback entre closers. No hay un prospecto comprando ahora.",
    "Si están ensayando o revisando llamadas, es INTERNA, aunque hablen de ventas o de un programa.",
    "",
    "NO_COMERCIAL",
    "Personal, operativa, logística, o no se está vendiendo nada.",
    "",
    "Si es INTERNA o NO_COMERCIAL: estado_agenda ese valor, confianza >= 95, producto, montos, pago y seguimiento en null, requiere_seguimiento = false. cliente_real puede ser con quién se practicó, o null. notas_crm = una frase de qué tipo de sesión fue. En notas_crm escribe Asistió o No asistió, nunca SHOW ni NO SHOW.",
    "",
    "CAMPOS ADICIONALES",
    "calificado: true, false o null.",
    `razon_no_cierre: uno de ${RAZONES_NO_CIERRE.join(" | ")} o null.`,
    `etapa_perdida: uno de ${ETAPAS_PERDIDAS.join(" | ")} o null.`,
    "canal_contacto: ZOOM | MEET | WHATSAPP | LLAMADA | PRESENCIAL, o null.",
    "telefono: si aparece en la llamada, si no null.",
    "email: si aparece en la llamada, si no null.",
    "",
    "El JSON de salida sigue siendo uno solo, sin texto alrededor.",
    "Incluye todas las claves de la sección 28 del PAE y, al final, estas claves:",
    '"calificado": null',
    '"razon_no_cierre": null',
    '"etapa_perdida": null',
    '"canal_contacto": null',
    '"telefono": null',
    '"email": null',
    "estado_agenda puede usar también AGENDADO, ACUERDO SIN PAGO, INTERNA o NO_COMERCIAL.",
    "venta_total, cash_collected y saldo_pendiente son números o null, sin símbolos.",
    "Dentro de los textos no uses comillas dobles.",
    "producto es exactamente un nombre de la lista de productos del PAE, o null. Nunca un acuerdo, una frase del closer ni una petición. Si el texto es un acuerdo, va en acuerdo_seguimiento y producto queda null.",
    "",
    "DATOS YA CONOCIDOS DE ESTA LLAMADA",
    `FECHA_LLAMADA: ${args.fechaLlamada || "null"}`,
    "Si FECHA_LLAMADA es null, no la inventes.",
    `Título / archivo: ${args.title}`,
    products.length ? null : "La lista de productos del PAE está vacía. producto = null.",
    payments.length ? null : "La lista de modos de pago del PAE está vacía. modo_pago = null.",
    args.readyCrm
      ? null
      : "No hay oferta CRM lista. Deja producto, venta_total, cash_collected, saldo_pendiente y modo_pago en null.",
    hints
      ? [
          "",
          "CORRECCIONES DE ESTE CLOSER",
          hints,
          "Si el caso coincide, clasifica así con confianza >= 95. No le pidas al closer que reconfirme.",
        ].join("\n")
      : null,
    "",
    "TRANSCRIPCIÓN:",
    args.transcript.slice(0, 24000),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return `${protocol}\n\n${appendix}`;
}

function num(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function conf(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function str(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value || value.toLowerCase() === "null") return null;
  return value;
}

export function parseExtractorJson(raw: unknown): ExtractorJson {
  const row = (raw || {}) as Record<string, unknown>;
  const evidencia = (row.evidencia || {}) as Record<string, unknown>;
  const confianza = (row.confianza || {}) as Record<string, unknown>;
  const requiere =
    row.requiere_seguimiento === true
      ? true
      : row.requiere_seguimiento === false
        ? false
        : null;
  const parsed: ExtractorJson = {
    ...emptyExtractor(),
    cliente_real: str(row.cliente_real),
    estado_agenda: normalizeEstadoAgenda(str(row.estado_agenda)),
    producto: str(row.producto),
    venta_total: num(row.venta_total),
    cash_collected: num(row.cash_collected),
    saldo_pendiente: num(row.saldo_pendiente),
    modo_pago: str(row.modo_pago),
    requiere_seguimiento: requiere,
    tipo_seguimiento: str(row.tipo_seguimiento)?.toUpperCase() || null,
    proximo_seguimiento: str(row.proximo_seguimiento),
    acuerdo_seguimiento: str(row.acuerdo_seguimiento),
    notas_crm: spanishAgendaInText(str(row.notas_crm)) || null,
    evidencia: {
      identidad: str(evidencia.identidad),
      cierre: str(evidencia.cierre),
      venta_total: str(evidencia.venta_total),
      cash_collected: str(evidencia.cash_collected),
      modo_pago: str(evidencia.modo_pago),
      seguimiento: str(evidencia.seguimiento),
    },
    confianza: {
      cliente_real: conf(confianza.cliente_real),
      estado_agenda: conf(confianza.estado_agenda),
      producto: conf(confianza.producto),
      venta_total: conf(confianza.venta_total),
      cash_collected: conf(confianza.cash_collected),
      modo_pago: conf(confianza.modo_pago),
      requiere_seguimiento: conf(confianza.requiere_seguimiento),
      tipo_seguimiento: conf(confianza.tipo_seguimiento),
      proximo_seguimiento: conf(confianza.proximo_seguimiento),
      acuerdo_seguimiento: conf(confianza.acuerdo_seguimiento),
    },
    requiere_revision_humana: Boolean(row.requiere_revision_humana),
    motivo_revision: str(row.motivo_revision),
    calificado:
      row.calificado === true ? true : row.calificado === false ? false : null,
    razon_no_cierre: str(row.razon_no_cierre),
    etapa_perdida: str(row.etapa_perdida),
    canal_contacto: str(row.canal_contacto)?.toUpperCase() || null,
    telefono: str(row.telefono),
    email: str(row.email),
    seguimiento_resultado: str(row.seguimiento_resultado),
    seguimiento_cerrado: str(row.seguimiento_cerrado),
    seguimiento_intentos: Number.isFinite(Number(row.seguimiento_intentos))
      ? Number(row.seguimiento_intentos)
      : null,
    seguimiento_undo:
      row.seguimiento_undo && typeof row.seguimiento_undo === "object"
        ? row.seguimiento_undo
        : null,
  };

  const gatedKeys = [
    "cliente_real",
    "estado_agenda",
    "producto",
    "venta_total",
    "cash_collected",
    "modo_pago",
    "requiere_seguimiento",
    "tipo_seguimiento",
    "proximo_seguimiento",
    "acuerdo_seguimiento",
  ] as const;
  for (const key of gatedKeys) {
    if (parsed.confianza[key] < 85) {
      if (key === "estado_agenda" && isNonSalesCall(parsed.estado_agenda)) {
        continue;
      }
      if (key === "proximo_seguimiento") {
        if (parsed.confianza[key] < 70 && !inferFollowupDate(parsed.proximo_seguimiento || "")) {
          parsed.proximo_seguimiento = null;
        }
        continue;
      }
      if (key === "requiere_seguimiento") {
        if (parsed.requiere_seguimiento !== false) parsed.requiere_seguimiento = null;
      } else if (key === "venta_total" || key === "cash_collected") {
        parsed[key] = null;
      } else {
        (parsed as Record<string, unknown>)[key] = null;
      }
    }
  }
  if (
    parsed.estado_agenda === "SHOW" &&
    parsed.confianza.estado_agenda >= 95
  ) {
    /* keep SHOW even if other fields gated */
  }
  if (
    parsed.venta_total != null &&
    parsed.cash_collected != null &&
    parsed.saldo_pendiente == null
  ) {
    parsed.saldo_pendiente = Math.max(0, parsed.venta_total - parsed.cash_collected);
  }
  return parsed;
}

export function enrichExtractorFollowup(
  parsed: ExtractorJson,
  args: { transcript?: string | null; callAt?: Date | string | null },
) {
  if (isNonSalesCall(parsed.estado_agenda)) return parsed;
  const transcript = String(args.transcript || "");
  const closed = followupIsClosed(parsed);
  const pinned = ["no_contesto", "no_mostro", "reprogramado"].includes(
    String(parsed.seguimiento_resultado || "").toLowerCase(),
  );
  fillStatedDeal(transcript, parsed);
  if (closed || (pinned && parsed.proximo_seguimiento)) {
    return normalizeImportedFiling(parsed, transcript);
  }
  const blobs = [
    parsed.proximo_seguimiento,
    parsed.evidencia.seguimiento,
    parsed.acuerdo_seguimiento,
    parsed.notas_crm,
    String(args.transcript || "").slice(-8_000),
  ]
    .filter(Boolean)
    .join("\n");
  const inferred = inferFollowupDate(`${blobs}\n${transcript}`, args.callAt);
  if (!inferred) {
    if (parsed.proximo_seguimiento && parsed.requiere_seguimiento == null) {
      parsed.requiere_seguimiento = true;
    }
    return normalizeImportedFiling(parsed, transcript);
  }
  const current = parsed.proximo_seguimiento || "";
  const sameDay = current.slice(0, 10) === inferred.slice(0, 10);
  const inferredTime = /\d{2}:\d{2}/.test(inferred);
  const currentTime = /\d{2}:\d{2}/.test(current);
  if (!current || !/^\d{4}-\d{2}-\d{2}/.test(current) || (inferredTime && sameDay && !currentTime)) {
    parsed.proximo_seguimiento = inferred;
    parsed.confianza.proximo_seguimiento = Math.max(parsed.confianza.proximo_seguimiento, 85);
  }
  if (parsed.requiere_seguimiento == null) {
    parsed.requiere_seguimiento = true;
    parsed.confianza.requiere_seguimiento = Math.max(parsed.confianza.requiere_seguimiento, 85);
  }
  return normalizeImportedFiling(parsed, transcript);
}

export type ExtractorGap = { field: string; question: string; options?: string[] };

export function extractorGap(
  parsed: ExtractorJson,
  readyCrm: boolean,
  offers?: { productName: string }[],
): ExtractorGap | null {
  if (isNonSalesCall(parsed.estado_agenda)) return null;
  const name = parsed.cliente_real || "el lead";
  if (parsed.requiere_revision_humana && !parsed.cliente_real) {
    return {
      field: "cliente_real",
      question: parsed.motivo_revision || "¿Con quién hablaste en esta llamada?",
    };
  }
  if (!parsed.cliente_real) {
    return { field: "cliente_real", question: "¿Con quién hablaste?" };
  }
  if (!parsed.estado_agenda) {
    return {
      field: "estado_agenda",
      question: `¿${name} asistió, no asistió, reprogramó, acordó o cerró?`,
    };
  }
  const offerNames = (offers || []).map((offer) => offer.productName).filter(Boolean);
  if (readyCrm && !parsed.producto && offerNames.length > 0) {
    return {
      field: "producto",
      question: `¿A qué oferta pertenece la llamada con ${name}?`,
      options: offerNames,
    };
  }
  if (
    parsed.estado_agenda === "CIERRE VENTA" ||
    parsed.estado_agenda === "ACUERDO SIN PAGO"
  ) {
    if (readyCrm && parsed.venta_total == null) {
      return {
        field: "venta_total",
        question: `¿Cuál fue el valor de la venta con ${name}?`,
      };
    }
    if (
      readyCrm &&
      parsed.estado_agenda === "CIERRE VENTA" &&
      parsed.cash_collected == null
    ) {
      return {
        field: "cash_collected",
        question: `¿Cuánto pagó ${name} en la llamada?`,
      };
    }
  }
  if (parsed.requiere_seguimiento === true && !parsed.tipo_seguimiento) {
    return {
      field: "tipo_seguimiento",
      question: `¿Qué seguimiento quedó con ${name}? (segunda reunión, pago, decisión, retomar)`,
    };
  }
  if (parsed.requiere_seguimiento === true && !parsed.proximo_seguimiento) {
    return {
      field: "proximo_seguimiento",
      question: `¿Para cuándo quedó el seguimiento con ${name}? (día o fecha)`,
    };
  }
  if (parsed.requiere_seguimiento === null) {
    return {
      field: "requiere_seguimiento",
      question: `¿Quedó algún seguimiento con ${name}?`,
    };
  }
  if (!readyCrm) {
    if (parsed.requiere_revision_humana) {
      return {
        field: "revision",
        question:
          parsed.motivo_revision ||
          `¿Se hizo la llamada con ${name}? Asistió, no asistió o reprogramó`,
      };
    }
    return null;
  }
  if (parsed.requiere_revision_humana) {
    return {
      field: "revision",
      question:
        parsed.motivo_revision ||
        `Hace falta confirmar un dato de la llamada con ${name}.`,
    };
  }
  const crmKeys: (keyof ExtractorConfianza)[] = [
    "cliente_real",
    "estado_agenda",
  ];
  for (const key of crmKeys) {
    if (parsed.confianza[key] < 85) {
      return {
        field: key,
        question: `¿Confirmas ${key.replace(/_/g, " ")} de ${name}?`,
      };
    }
  }
  return null;
}

export function extractorOneLiner(parsed: ExtractorJson) {
  if (isNonSalesCall(parsed.estado_agenda)) {
    return (
      parsed.notas_crm ||
      (parsed.estado_agenda === "INTERNA"
        ? "Sesión interna (coach/práctica). No entra al CRM."
        : "Llamada no comercial. No entra al CRM.")
    );
  }
  const bits = [
    parsed.cliente_real,
    parsed.producto,
    parsed.estado_agenda,
    parsed.proximo_seguimiento
      ? `seguimiento ${parsed.proximo_seguimiento}`
      : parsed.acuerdo_seguimiento,
  ].filter(Boolean);
  return labelCrmProse(`${bits.join(" · ") || "Llamada"} — listo`);
}

export async function runExtractor(args: {
  offers: OfferForCrm[];
  title: string;
  fechaLlamada: string | null;
  transcript: string;
  readyCrm: boolean;
  hints?: string | null;
}) {
  const prompt = buildExtractorPrompt(args);
  try {
    const text = await generateGeminiJson(prompt, 0.1, 4096, {
      timeoutMs: 90_000,
      models: ["gemini-flash-latest", "gemini-flash-lite-latest"],
    });
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/```$/u, "")
      .trim();
    return enrichExtractorFollowup(parseExtractorJson(JSON.parse(cleaned)), {
      transcript: args.transcript,
      callAt: args.fechaLlamada,
    });
  } catch {
    const fallback = emptyExtractor();
    fallback.requiere_revision_humana = true;
    fallback.motivo_revision = "No pude leer la llamada. ¿Qué pasó?";
    return fallback;
  }
}
