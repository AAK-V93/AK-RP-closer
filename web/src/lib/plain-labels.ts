import { humanizeSlashDates } from "@/lib/crm-time";

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
  COBRO_VENCIDO: "Cobro atrasado",
  COMISION: "Comisión",
  AGENDA_CHECK: "¿Se hizo?",
  ONBOARDING: "Bienvenida",
  HOY: "Hoy",
  VENCIDO: "Atrasado",
  "PRÓXIMO": "Próximo",
  SI: "Sí",
  SÍ: "Sí",
  NO: "No",
  ZOOM: "Zoom",
  MEET: "Meet",
  WHATSAPP: "WhatsApp",
  VIDEO: "Vídeo",
  video: "Vídeo",
  LLAMADA: "Llamada",
  PRESENCIAL: "Presencial",
  EMAIL: "Correo",
  OTROS: "Otros",
  OTRO: "Otro",
  INTERNA: "Interna",
  NO_COMERCIAL: "No comercial",
  PARCIAL: "Parcial",
  CASH: "Contado",
  CONTADO: "Contado",
  seguimiento: "Seguimiento",
  pendiente: "Pendiente",
  cobro: "Cobro",
  nuevo: "Nuevo",
  cerrado: "Cerrado",
  perdido: "Perdido",
  cerro: "Cerró",
  no_cerro: "No cerró",
  sin_grabacion: "Sin grabación",
  caido: "Cayó",
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

/** Notes written as SHOW / NO SHOW, shown as Asistió / No asistió. */
export function spanishAgendaInText(value: string | null | undefined) {
  const text = String(value || "");
  if (!text.trim()) return "";
  return text
    .replace(/\bNO[\s_-]*SHOW\b/gi, "No asistió")
    .replace(/\bSHOW\b/gi, "Asistió");
}

const PROSE_CODES = Object.keys(STATUS_LABELS)
  .filter((key) => key === key.toUpperCase() && key.length >= 3 && STATUS_LABELS[key] && STATUS_LABELS[key] !== "—")
  .sort((a, b) => b.length - a.length);

/** Free text the closer reads. Codes become the same labels as the CRM. */
export function labelCrmProse(value: string | null | undefined) {
  let text = String(value || "");
  if (!text.trim()) return text;
  for (const key of PROSE_CODES) {
    const label = key === "CIERRE VENTA" ? "Cerró venta" : STATUS_LABELS[key];
    const body = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s_]+");
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "giu"), (match) => {
      const letters = match.replace(/[\s_]+/g, "");
      if (letters !== letters.toUpperCase()) return match;
      return label;
    });
  }
  return text;
}

const CHAT_STATUS_KEYS = new Set([
  "status",
  "tipo",
  "hilo",
  "estado",
  "callType",
  "result",
  "estadoAgenda",
  "etapa",
]);

const CHAT_PROSE_KEYS = new Set([
  "question",
  "contexto",
  "mensajeSugerido",
  "summary",
  "line",
  "content",
  "notas",
  "next",
  "nextStep",
  "acuerdo",
  "lastSummary",
]);

/** Snapshot text the Inicio model reads, with stage codes already in Spanish. */
export function presentChatState(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (CHAT_STATUS_KEYS.has(key)) {
      if (/^cierre[\s_]*venta$/i.test(value.trim())) return "Cerró venta";
      const labeled = plainStatus(value);
      return labeled === "—" ? value : labeled;
    }
    if (CHAT_PROSE_KEYS.has(key)) return labelCrmProse(value);
    return value;
  }
  if (Array.isArray(value)) {
    if (key === "appliedCalls" || key === "lines") return value.map((item) => labelCrmProse(String(item ?? "")));
    return value.map((item) => presentChatState(item));
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [child, inner] of Object.entries(value as Record<string, unknown>)) {
    out[child] = presentChatState(inner, child);
  }
  return out;
}

/** Same sentence as Inicio's banner. Llamadas must use this, not a second wording. */
export function porConfirmarLabel(count: number) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  return n === 1 ? "Tienes 1 llamada por confirmar" : `Tienes ${n} llamadas por confirmar`;
}

const SMALL_NAME = new Set(["de", "del", "la", "el", "los", "las", "y", "e", "en"]);

/** «KATHERINE REINOSO» → «Katherine Reinoso». A slash date becomes «30 sep». */
export function readableTitle(value: string | null | undefined, now = new Date()) {
  const text = String(value || "").trim();
  const letters = text.replace(/[^\p{L}]/gu, "");
  let shown = text;
  if (letters.length >= 4) {
    const upper = letters.replace(/[^\p{Lu}]/gu, "");
    if (upper.length / letters.length >= 0.7) {
      shown = text
        .toLocaleLowerCase("es")
        .split(/(\s+)/)
        .map((part, index) => {
          if (!part.trim()) return part;
          if (index > 0 && SMALL_NAME.has(part)) return part;
          return part.charAt(0).toLocaleUpperCase("es") + part.slice(1);
        })
        .join("");
    }
  }
  return humanizeSlashDates(shown, now);
}

const GENERIC_CALL_TITLE = /^(llamada|impromptu|google meet|zoom|meet|reuni[oó]n)\b/i;

/** A recording title that is already a person's name, not a date or a meeting label. */
export function personLikeTitle(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (text.length < 3 || text.length > 80) return "";
  if (/\d/.test(text) || /[·|/]/.test(text)) return "";
  if (GENERIC_CALL_TITLE.test(text)) return "";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return "";
  return text;
}

/**
 * The question uses the name already stored on the call.
 * The extractor's other spelling (Katherine vs Katerine) is not a new person.
 */
export function questionWithStoredName(question: string, storedName: string, parsedName: string) {
  const stored = storedName.trim();
  const parsed = parsedName.trim();
  const text = String(question || "");
  if (!stored || !parsed || stored === parsed) return text;
  if (!text.includes(parsed)) return text;
  return text.split(parsed).join(stored);
}

/** "1 llamada real" / "4 llamadas reales". */
export function countPhrase(count: number, singular: string, plural: string) {
  const n = Math.trunc(Number(count) || 0);
  return Math.abs(n) === 1 ? `1 ${singular}` : `${n} ${plural}`;
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
