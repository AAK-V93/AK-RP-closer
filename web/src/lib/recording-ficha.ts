import { foldLeadName } from "@/lib/crm-followups";
import { zonedDayKey, calendarDaysBetween } from "@/lib/crm-time";
import { personLikeTitle } from "@/lib/plain-labels";
import { isUsableTranscript } from "@/lib/fathom-import";
import { buildPersonFacts, type FactCall, type PersonFacts } from "@/lib/person-facts";
import type { ExtractorJson } from "@/lib/extractor";

/**
 * Ficha for a call that never reached the CRM (an old Fathom recording or an upload that was
 * never filed: Llamadas only files the newest 30). What came out of that call is read from the
 * recording on demand, shown, and never saved unless the closer taps «Guardar».
 */

export type RecordingRow = {
  id: string;
  kind: "fathom" | "upload";
  title: string;
  recordedAt: Date | string | null;
  transcript: string;
};

export type RecordingInfo = {
  id: string;
  kind: "fathom" | "upload";
  day: string;
  /** True when the facts come from reading the recording. */
  read: boolean;
  /** What the closer sees above the ficha. */
  note: string;
  /** «Agregar al CRM» can file this recording (it has a transcript and is not filed yet). */
  canAdd: boolean;
};

/**
 * Talk of money or a next step: worth reading (Arquitectura: only calls with a sale or a
 * follow-up). A recording without any of this is not sent to the model.
 */
const SALES_SIGNAL =
  /\b(precio|inversi[oó]n|invertir|cu[aá]nto cuesta|pago|pagar|pagas|cuotas?|tarjeta|transferencia|dep[oó]sito|reserva(r)?|separar (tu|el) cupo|d[oó]lares|usd|soles|te (llamo|escribo|contacto)|(volvemos|volver) a hablar|seguimiento|agendamos|agendar|la pr[oó]xima semana|lo (pienso|consulto|converso|hablo)|consultarlo|pensarlo|mi (esposo|esposa|socio|socia|pareja))\b|\$\s?\d/i;

export function hasSalesSignal(transcript: string | null | undefined) {
  return SALES_SIGNAL.test(String(transcript || ""));
}

/** At most this much transcript goes to the model (cost and time). */
export const RECORDING_TRANSCRIPT_LIMIT = 60_000;

export function recordingDay(row: Pick<RecordingRow, "recordedAt">) {
  const at = row.recordedAt ? new Date(row.recordedAt) : null;
  return at && Number.isFinite(at.getTime()) ? zonedDayKey(at) : "";
}

/** The recording the ficha was opened from: by id, else by the person's name on the title (closest day). */
export function pickRecording(
  rows: readonly RecordingRow[],
  target: { callId?: string | null; name?: string | null; day?: string | null },
) {
  const id = String(target.callId || "").trim();
  if (id) {
    const hit = rows.find((row) => row.id === id);
    if (hit) return hit;
  }
  const key = foldLeadName(String(target.name || ""));
  if (!key) return null;
  const day = String(target.day || "").slice(0, 10);
  const named = rows.filter((row) => foldLeadName(personLikeTitle(row.title)) === key);
  if (!named.length) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return named[0];
  return [...named].sort((a, b) => {
    const da = recordingDay(a);
    const db = recordingDay(b);
    const ga = da ? Math.abs(calendarDaysBetween(da, day)) : 9999;
    const gb = db ? Math.abs(calendarDaysBetween(db, day)) : 9999;
    return ga - gb;
  })[0];
}

export type RecordingReadState = "read" | "no-transcript" | "no-signal" | "failed";

export function recordingNote(state: RecordingReadState, day: string, today: string) {
  const when = day ? ` del ${shortDay(day, today)}` : "";
  switch (state) {
    case "read":
      return `Esta persona todavía no está en tu CRM. Esto sale de la grabación${when}; no se guardó nada.`;
    case "no-transcript":
      return `Esta persona todavía no está en tu CRM y la grabación${when} no tiene transcripción, así que no hay de dónde sacar lo que quedó.`;
    case "no-signal":
      return `Esta persona todavía no está en tu CRM. En la grabación${when} no se habló de precio, pago ni de un siguiente paso.`;
    default:
      return `Esta persona todavía no está en tu CRM. No pude leer la grabación${when} ahora; vuelve a abrir la ficha en un rato.`;
  }
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function shortDay(day: string, today: string) {
  const [y, m, d] = day.split("-").map(Number);
  const base = `${d} ${MONTHS[(m || 1) - 1]}`;
  return today.slice(0, 4) === String(y) ? base : `${base} ${y}`;
}

/** The recording as one call for buildPersonFacts. Only what the reading returned; nothing added. */
export function recordingCall(row: RecordingRow, name: string, parsed: ExtractorJson | null): FactCall {
  return {
    id: row.id,
    leadName: name,
    recordedAt: row.recordedAt,
    offerName: parsed?.producto || "",
    estadoAgenda: parsed?.estado_agenda || "",
    summary: "",
    ventaTotal: parsed?.venta_total ?? null,
    cashCollected: parsed?.cash_collected ?? null,
    saldoPendiente: parsed?.saldo_pendiente ?? null,
    modoPago: parsed?.modo_pago || "",
    filingJson: parsed ? { ...parsed, cliente_real: name } : {},
  };
}

export function recordingFicha(args: {
  name: string;
  row: RecordingRow;
  parsed: ExtractorJson | null;
  state: RecordingReadState;
  filed: boolean;
  now: Date;
}): { facts: PersonFacts; recording: RecordingInfo } {
  const today = zonedDayKey(args.now);
  const day = recordingDay(args.row);
  const facts = buildPersonFacts({
    lead: null,
    name: args.name,
    calls: args.parsed ? [recordingCall(args.row, args.name, args.parsed)] : [],
    now: args.now,
    openedFromDay: day,
  });
  return {
    facts,
    recording: {
      id: args.row.id,
      kind: args.row.kind,
      day,
      read: Boolean(args.parsed),
      note: recordingNote(args.state, day, today),
      canAdd: !args.filed && isUsableTranscript(args.row.transcript),
    },
  };
}

/* Short-lived memory cache: opening the same ficha twice does not read the recording twice. */
const CACHE_MS = 30 * 60_000;
const CACHE_MAX = 100;
const cache = new Map<string, { at: number; value: Promise<ExtractorJson | null> }>();

export function readRecordingOnce(key: string, read: () => Promise<ExtractorJson | null>, now = Date.now()) {
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = read().catch(() => null);
  cache.set(key, { at: now, value });
  // A failure is not kept: the next open tries again.
  void value.then((result) => {
    if (result == null && cache.get(key)?.value === value) cache.delete(key);
  });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}
