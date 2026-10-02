import { isNonSalesCall } from "@/lib/call-kind";
import { isInternalMeetingTitle, isInternalParticipantLabel } from "@/lib/call-intake";
import { isGenericMeetingTitle } from "@/lib/fathom-import";
import { zonedDayKey } from "@/lib/crm-time";

const INTERNAL_SESSION =
  /\b(feedback|coaching|coach|role[\s-]?play|pr[aá]ctica|practica|sesi[oó]n interna)\b/i;

export function realClientName(value?: string | null) {
  const text = String(value || "").trim();
  if (!text || text === "—" || text === "-" || text.toLowerCase() === "null") return "";
  if (isGenericMeetingTitle(text) || isInternalParticipantLabel(text)) return "";
  return text;
}

function dayOf(value?: string | Date | null) {
  if (!value) return "";
  if (value instanceof Date) return zonedDayKey(value) || "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return zonedDayKey(parsed) || text.slice(0, 10);
}

/** Untitled Meet/Zoom calls: the lead if we know them, otherwise a dated placeholder. */
export function visibleCallTitle(args: {
  title?: string | null;
  leadName?: string | null;
  date?: string | Date | null;
}) {
  const lead = realClientName(args.leadName);
  const title = String(args.title || "").trim();
  const generic = !title || isGenericMeetingTitle(title);
  if (!generic) return title;
  if (lead) return lead;
  const day = dayOf(args.date);
  return day ? `Llamada sin título · ${day}` : "Llamada sin título";
}

export function clienteVisible(cliente?: string | null, titulo?: string | null) {
  return realClientName(cliente) || String(titulo || "").trim() || "—";
}

/**
 * Internal sessions and rows with no client. Data stays; the screen hides them
 * until the closer asks to see llamadas internas.
 */
export function isInternalNoise(args: {
  cliente?: string | null;
  estadoAgenda?: string | null;
  callType?: string | null;
  title?: string | null;
}) {
  if (isNonSalesCall(args.estadoAgenda) || isNonSalesCall(args.callType)) return true;
  const title = String(args.title || "").trim();
  if (isInternalMeetingTitle(title) || INTERNAL_SESSION.test(title)) return true;
  if (!realClientName(args.cliente)) return true;
  return false;
}

export function hiddenInternalCount<T extends { interna?: boolean }>(rows: T[]) {
  return rows.filter((row) => row.interna).length;
}
