/**
 * What was agreed and what is missing, from what the extractor already stored.
 * Never a description of the recording («se corta la transcripción…») and never
 * a sentence cut in the middle. Nothing is invented: without an agreement the
 * closer reads «No quedó claro el siguiente paso».
 */

export const UNCLEAR_NEXT_STEP = "No quedó claro el siguiente paso.";

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Text about the recording, not about the person. */
const RECORDING_META =
  /\b(transcripci[oó]n|transcript|grabaci[oó]n|audio|se corta|se cort[oó]|cortad[ao]|incomplet[ao]|se interrump|interrumpid[ao]|no se (oye|escucha)|sin sonido|mala conexi[oó]n|se cae la llamada|se cay[oó] la llamada|no llega a|termina abruptamente)/i;

/** «Llamada comercial donde…», «Llamada realizada con…»: a description of the call. */
const CALL_DESCRIPTION =
  /^(la\s+)?(llamada|reuni[oó]n|sesi[oó]n|conversaci[oó]n|videollamada)\s+(comercial|de ventas|de venta|realizada|inicial|de diagn[oó]stico|de descubrimiento|con|donde|en la que|en donde|entre)\b/i;

/** A note only counts as an agreement when it says what someone will do. */
const AGREEMENT_HINT =
  /\b(qued[oó]|quedamos|quedaron|acord|acuerd|va a|van a|vamos a|enviar|envi[oó]|enviar[aá]|mandar|mand[oó]|revisar|revisar[aá]|confirmar|confirmar[aá]|pagar|pagar[aá]|pago|responder|responder[aá]|respuesta|decidir|decidir[aá]|decisi[oó]n|hablar|hablarlo|consultar|consultarlo|segunda reuni[oó]n|agend|llamar|llamarlo|llamarla|propuesta|link|transferencia|reserva|cuota|firmar|contrato)\b/i;

export function isRecordingMeta(sentence: string) {
  return RECORDING_META.test(sentence);
}

export function describesTheCall(sentence: string) {
  return CALL_DESCRIPTION.test(sentence.trim());
}

export function soundsLikeAgreement(sentence: string) {
  return AGREEMENT_HINT.test(sentence);
}

/** Sentences as written. A trailing piece without a period is kept apart so we can drop it. */
export function splitSentences(text: string) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\.{2,}|…/g, ".")
    .trim();
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?])\s+(?=[¿¡«"(\p{Lu}\p{N}])/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function capitalize(value: string) {
  return value.replace(/^(¿|¡)?(\p{L})/u, (_, mark: string, letter: string) => `${mark || ""}${letter.toLocaleUpperCase("es")}`);
}

function ended(value: string) {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

const LONG = 220;

/** «…, pero la llamada» with no period: the stored text was cut. Drop that last clause. */
function dropCutClause(part: string) {
  if (/[.!?]$/.test(part)) return part;
  const comma = part.lastIndexOf(",");
  if (comma < 12) return part;
  const tail = part.slice(comma + 1).trim();
  const words = tail.split(/\s+/).filter(Boolean);
  if (words.length <= 5 && /^(pero|y|aunque|porque|mientras|sin embargo|que|donde)\b/i.test(tail)) {
    return part.slice(0, comma).trim();
  }
  return part;
}

/**
 * Up to two whole sentences without the recording talk. A last piece with no
 * period after a complete sentence is a cut and goes away. Never «…».
 */
export function wholeSentences(text: string, max = 2) {
  const parts = splitSentences(text).filter((part) => !isRecordingMeta(part) && !describesTheCall(part));
  if (!parts.length) return "";
  if (parts.length > 1 && !/[.!?]$/.test(parts[parts.length - 1])) parts.pop();
  else if (parts.length === 1) parts[0] = dropCutClause(parts[0]);
  const picked: string[] = [];
  for (const part of parts) {
    if (picked.length >= max) break;
    const next = [...picked, ended(capitalize(part))].join(" ");
    if (picked.length && next.length > LONG) break;
    picked.push(ended(capitalize(part)));
  }
  return picked.join(" ");
}

/** An agreement field (acuerdo, siguiente paso): keep it unless it is recording talk. */
export function agreementFromField(text: string | null | undefined) {
  return wholeSentences(String(text || ""));
}

/** A free note: only the sentences that say what someone will do. */
export function agreementFromNote(text: string | null | undefined) {
  const parts = splitSentences(String(text || "")).filter(
    (part) => !isRecordingMeta(part) && !describesTheCall(part) && soundsLikeAgreement(part),
  );
  return wholeSentences(parts.join(" "));
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function dayPhrase(proximo: string | null | undefined, today: string) {
  const match = String(proximo || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  const short = `${Number(match[3])} ${MONTHS_SHORT[Number(match[2]) - 1] || ""}`.trim();
  if (!today) return `para el ${short}`;
  if (day === today) return "para hoy";
  return day > today ? `para el ${short}` : `pendiente desde el ${short}`;
}

/** The missing piece, from the follow-up kind the extractor stored. */
export function missingPhrase(tipo: string | null | undefined) {
  const key = fold(String(tipo || "")).replace(/_/g, " ").trim();
  if (!key) return "";
  if (key.includes("segunda") || key.includes("reunion")) return "Falta la segunda reunión";
  if (key.includes("reagend")) return "Falta reagendar la reunión";
  if (key.includes("cobr") || key.includes("pago")) return "Falta el pago";
  if (key.includes("decision")) return "Falta su respuesta";
  if (key.includes("onboarding")) return "Falta que arranque";
  return "";
}

function alreadySays(agreed: string, missing: string) {
  const a = fold(agreed);
  if (/reunion/.test(fold(missing))) return /reuni/.test(a);
  if (/pago/.test(fold(missing))) return /\bpag|cuota|transferencia|link/.test(a);
  if (/respuesta/.test(fold(missing))) return /respuest|decid|decision/.test(a);
  return false;
}

export type AgreementSummary = {
  /** What was agreed, whole sentences. Empty when nothing was said. */
  agreed: string;
  /** «Falta el pago, para el 12 oct.» Empty when the kind is unknown or the agreement already says it. */
  missing: string;
  /** What the closer reads: agreed + missing, or «No quedó claro el siguiente paso». */
  text: string;
  clear: boolean;
};

export function agreementSummary(args: {
  /** Agreement fields, most trusted first (acuerdo of the call, lead next step…). */
  agreements: (string | null | undefined)[];
  /** Free notes (notas_crm, resumen). Only agreement sentences are used. */
  notes?: (string | null | undefined)[];
  tipo?: string | null;
  proximo?: string | null;
  /** Bogotá day key (YYYY-MM-DD) to say «para» or «pendiente desde». */
  today?: string;
}): AgreementSummary {
  let agreed = "";
  for (const field of args.agreements) {
    agreed = agreementFromField(field);
    if (agreed) break;
  }
  if (!agreed) {
    for (const note of args.notes || []) {
      agreed = agreementFromNote(note);
      if (agreed) break;
    }
  }
  if (!agreed) return { agreed: "", missing: "", text: UNCLEAR_NEXT_STEP, clear: false };
  const phrase = missingPhrase(args.tipo);
  let missing = "";
  if (phrase && !alreadySays(agreed, phrase)) {
    const when = dayPhrase(args.proximo, args.today || "");
    missing = when ? `${phrase}, ${when}.` : `${phrase}.`;
  }
  return { agreed, missing, text: [agreed, missing].filter(Boolean).join(" "), clear: true };
}
