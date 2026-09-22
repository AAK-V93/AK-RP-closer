import { generateGeminiJson } from "@/lib/gemini";
import type { OfferForCrm } from "@/lib/offer-commercial";
import { RAZONES_NO_CIERRE, ETAPAS_PERDIDAS } from "@/lib/crm-catalog";
import { isNonSalesCall, normalizeEstadoAgenda } from "@/lib/call-kind";
import { inferFollowupDate } from "@/lib/followup-date";

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
  };
}

export function isExtractorJson(raw: unknown): raw is ExtractorJson {
  if (!raw || typeof raw !== "object") return false;
  const row = raw as Record<string, unknown>;
  return "estado_agenda" in row || "cliente_real" in row;
}

function productBlock(offers: OfferForCrm[]) {
  if (!offers.length) {
    return `Valores permitidos:
OTROS

No hay ofertas CRM listas. Si reconoces un producto, usa OTROS.`;
  }
  const lines = offers.map((offer) => {
    const aliases = offer.commercial.aliases.length
      ? ` (alias: ${offer.commercial.aliases.join(", ")})`
      : "";
    const price = offer.commercial.listPrice
      ? ` · lista ${offer.commercial.currency} ${offer.commercial.listPrice}`
      : "";
    const alts = offer.commercial.altPrices
      .map((row) => `${row.label}${row.amount != null ? ` ${row.amount}` : ""}`)
      .join(" · ");
    const plazos = offer.commercial.deadlines
      .map((row) => `${row.name} (${row.days} días)`)
      .join(" · ");
    return `- ${offer.productName}${aliases}${price}${alts ? `\n  precios: ${alts}` : ""}${plazos ? `\n  plazos: ${plazos}` : ""}${offer.commercial.duration ? `\n  duración: ${offer.commercial.duration}` : ""}`;
  });
  return `Valores permitidos (ofertas de ESTE closer):
${lines.join("\n")}
OTROS

Mapea al nombre exacto de la lista.
Si el nombre o un alias se dice en la llamada, usa ese nombre y confianza >= 95.
Si un monto (precio negociado, lista o alternativo) coincide con UNA sola oferta, usa esa oferta y confianza >= 95.
Si el monto coincide con dos ofertas, o no hay nombre ni monto, producto = null y confianza < 50.
Nunca elijas una oferta por defecto cuando hay ambigüedad entre dos.`;
}

function paymentBlock(offers: OfferForCrm[]) {
  const modes = offers.flatMap((offer) =>
    offer.commercial.paymentModes.map(
      (mode) => `- ${offer.productName}: ${mode.name}${mode.details ? ` — ${mode.details}` : ""}`,
    ),
  );
  const commissions = offers
    .map((offer) => {
      const rule = offer.commercial.commission;
      if (!rule) return "";
      const tiers = rule.tiers
        .map((tier) => {
          const pct = tier.pct != null ? `${Math.round(tier.pct * 1000) / 10}%` : "";
          return `${tier.label || tier.when || tier.paymentMode} ${pct}`.trim();
        })
        .filter(Boolean)
        .join("; ");
      const body = rule.notes || tiers;
      return body ? `- Comisión ${offer.productName}: ${body}` : "";
    })
    .filter(Boolean);
  if (!modes.length) {
    return `Valores de modo_pago: el texto libre de la estructura final aceptada. Si no hay evidencia: null.${
      commissions.length ? `\n${commissions.join("\n")}` : ""
    }`;
  }
  return `Valores de modo_pago: usa el nombre de la estructura de la oferta que coincida.
${modes.join("\n")}
${commissions.length ? `${commissions.join("\n")}\n` : ""}Si el lead aceptó una estructura que no está en la lista, descríbela breve. CONTADO = valor final pagado completo. RESERVA = pago parcial confirmado con saldo. El modo_pago debe poder emparejarse con un tramo de comisión si existe.`;
}

export function buildExtractorPrompt(args: {
  offers: OfferForCrm[];
  title: string;
  fechaLlamada: string | null;
  transcript: string;
  readyCrm: boolean;
  hints?: string | null;
}) {
  const productos = productBlock(args.offers);
  const pagos = paymentBlock(args.offers);
  const moneyNote = args.readyCrm
    ? "Puedes extraer producto, montos y modo de pago."
    : "NO hay oferta CRM lista. Extrae identidad y estado_agenda (SHOW / NO SHOW / REPROGRAMA / AGENDADO). Deja producto, montos y modo_pago en null.";

  return `Eres “Extractor Comercial IA”. Tu única función es transformar transcripciones de llamadas comerciales en datos estructurados, verificables y seguros para un CRM.

PRINCIPIO CENTRAL
Nunca inventes información. Es preferible null antes que un dato incorrecto.
Analiza la llamada completa antes de emitir una conclusión.

${moneyNote}
${
  args.hints?.trim()
    ? `
==================================================
CORRECCIONES DE ESTE CLOSER
==================================================
${args.hints.trim()}
Si el caso coincide, clasifica así con confianza >= 95. No le pidas al closer que reconfirme.`
    : ""
}

==================================================
FASE 1 — NORMALIZACIÓN OBLIGATORIA
==================================================
Antes del análisis comercial, normaliza internamente la transcripción.
NO hagas un resumen. Convierte VTT/Zoom/Fathom en una conversación limpia y cronológica.
Elimina únicamente ruido técnico (numeración VTT, timestamps, metadata, IDs, segmentos consecutivos del mismo hablante).
NO elimines contenido comercial. Conserva especialmente el tramo final.
FECHA_LLAMADA conocida: ${args.fechaLlamada || "null (no inventar)"}.
Título / archivo: ${args.title}

==================================================
FASE 2 — ANÁLISIS COMERCIAL
==================================================
Reconstruye cronológicamente: identidad, diagnóstico, pitch, producto, precios, objeciones, negociación, acuerdo final, pagos, saldo, seguimiento.

Nunca confundas:
precio mencionado ≠ oferta ≠ valor contractual final ≠ pago prometido ≠ pago ejecutado.

CASH COLLECTED = dinero efectivamente cobrado DURANTE ESTA llamada. No pagos históricos. No “lo hago esta tarde”.
Enviar un link NO es pago. “Lo hago ahora” NO es pago.

SEGUNDA PASADA OBLIGATORIA del último 25%: acuerdo final, precio final, pago, comprobante, bienvenida, siguiente reunión, FECHA de seguimiento.

==================================================
ESTADO AGENDA
==================================================
Valores permitidos:
INTERNA
NO_COMERCIAL
SHOW
CIERRE VENTA
ACUERDO SIN PAGO
REPROGRAMA
NO SHOW
AGENDADO

ANTES de clasificar como SHOW, decide si esto ni siquiera es una llamada de ventas:
INTERNA = coaching, práctica, roleplay, auditoría de llamadas, junta de equipo/directivos, feedback entre closers. No hay un prospecto comprando AHORA.
NO_COMERCIAL = personal, operativa, logistica, o no se está vendiendo nada.
Si es INTERNA o NO_COMERCIAL: estado_agenda ese valor, confianza >= 95, producto/montos/pago/seguimiento en null, requiere_seguimiento = false. cliente_real puede ser con quién se practicó o null. notas_crm = una frase de qué tipo de sesión fue.
NO uses SHOW solo porque hablaron de ventas o de un programa: si están ensayando o revisando llamadas, es INTERNA.

Si existe conversación comercial REAL closer↔prospecto (el prospecto está en la llamada para comprar o decidir): estado_agenda = SHOW, confianza mínima 95, aunque falte el final.
CIERRE VENTA requiere acuerdo definitivo + dinero cobrado EN la llamada.
ACUERDO SIN PAGO: acuerdo definitivo (producto, precio, modo) pero el pago se hará fuera de la llamada. NO es CIERRE VENTA.
REPROGRAMA: no se realizó la llamada comercial y se movió.
NO SHOW: la reunión no ocurrió. Si hay conversación comercial real, nunca NO SHOW.
AGENDADO: la llamada todavía no ocurre (solo si el texto es una agenda futura, no una llamada ya hecha).

==================================================
PRODUCTOS
==================================================
${productos}

==================================================
MODO DE PAGO
==================================================
${pagos}

==================================================
SEGUIMIENTO
==================================================
requiere_seguimiento: true | false | null
true = acción comercial futura clara. false = evidencia de que no queda nada. null = insuficiente.
Nunca uses false solo porque no encontraste seguimiento.
tipo_seguimiento: SEGUNDA REUNION | PAGO PENDIENTE | DECISION | RETOMAR | OTRO
proximo_seguimiento: YYYY-MM-DD o YYYY-MM-DD HH:MM. OBLIGATORIO si hay cualquier fecha (absoluta o relativa).
Usa FECHA_LLAMADA para resolver: “hoy”, “mañana”, “pasado mañana”, “el lunes/martes/…”, “el 20”, “el 20 de septiembre”, “en 3 días”, “la otra semana”.
Si el closer o el lead dicen “te escribo el jueves” / “nos vemos el lunes” / “te marco mañana”, eso ES una fecha: conviértela. No dejes null.
Copia en evidencia.seguimiento la frase textual que prueba la fecha.
Si hay seguimiento claro pero no hay día, proximo_seguimiento = null y requiere_revision_humana no sustituye esa fecha: el hueco es la fecha.
acuerdo_seguimiento: una frase operativa.

==================================================
CAMPOS EXTRA (coach)
==================================================
calificado: true/false/null
razon_no_cierre: uno de ${RAZONES_NO_CIERRE.join(" | ")} o null
etapa_perdida: uno de ${ETAPAS_PERDIDAS.join(" | ")} o null
canal_contacto: ZOOM | MEET | WHATSAPP | LLAMADA | PRESENCIAL o null
telefono, email: si aparecen, si no null

==================================================
CONFIANZA
==================================================
95-100 = explícito. 85-94 = evidencia fuerte. 70-84 = ambiguo. 0-69 = insuficiente.
Si confianza < 85 en un campo CRM, ese campo debe ir null.
Excepción: estado_agenda = SHOW con conversación real puede ir con confianza >= 95 aunque falte el cierre.

requiere_revision_humana = true si hay riesgo real (final inaccesible, identidad ambigua, posible pago no confirmado).

==================================================
OUTPUT
==================================================
Devuelve ÚNICAMENTE JSON válido. Sin texto alrededor.
Usa exactamente estas claves:

{
  "cliente_real": null,
  "estado_agenda": null,
  "producto": null,
  "venta_total": null,
  "cash_collected": null,
  "saldo_pendiente": null,
  "modo_pago": null,
  "requiere_seguimiento": null,
  "tipo_seguimiento": null,
  "proximo_seguimiento": null,
  "acuerdo_seguimiento": null,
  "notas_crm": null,
  "evidencia": {
    "identidad": null,
    "cierre": null,
    "venta_total": null,
    "cash_collected": null,
    "modo_pago": null,
    "seguimiento": null
  },
  "confianza": {
    "cliente_real": 0,
    "estado_agenda": 0,
    "producto": 0,
    "venta_total": 0,
    "cash_collected": 0,
    "modo_pago": 0,
    "requiere_seguimiento": 0,
    "tipo_seguimiento": 0,
    "proximo_seguimiento": 0,
    "acuerdo_seguimiento": 0
  },
  "requiere_revision_humana": false,
  "motivo_revision": null,
  "calificado": null,
  "razon_no_cierre": null,
  "etapa_perdida": null,
  "canal_contacto": null,
  "telefono": null,
  "email": null
}

venta_total, cash_collected, saldo_pendiente son números o null (sin símbolos).
Dentro de textos, no uses comillas dobles.

TRANSCRIPCIÓN:
${args.transcript.slice(0, 24000)}`;
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
    notas_crm: str(row.notas_crm),
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
  const blobs = [
    parsed.proximo_seguimiento,
    parsed.evidencia.seguimiento,
    parsed.acuerdo_seguimiento,
    parsed.notas_crm,
    String(args.transcript || "").slice(-8_000),
  ]
    .filter(Boolean)
    .join("\n");
  const inferred = inferFollowupDate(blobs, args.callAt);
  if (!inferred) return parsed;
  if (!parsed.proximo_seguimiento || !/^\d{4}-\d{2}-\d{2}/.test(parsed.proximo_seguimiento)) {
    parsed.proximo_seguimiento = inferred;
    parsed.confianza.proximo_seguimiento = Math.max(parsed.confianza.proximo_seguimiento, 85);
  }
  if (parsed.requiere_seguimiento == null) {
    parsed.requiere_seguimiento = true;
    parsed.confianza.requiere_seguimiento = Math.max(parsed.confianza.requiere_seguimiento, 85);
  }
  return parsed;
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
      question: `¿${name} hizo show, no show, reprogramó, acordó o cerró?`,
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
          `¿Se hizo la llamada con ${name}? SHOW / NO SHOW / REPROGRAMA`,
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
  return `${bits.join(" · ") || "Llamada"} — listo`;
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
