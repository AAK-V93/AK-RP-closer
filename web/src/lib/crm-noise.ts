import { isNonSalesCall } from "@/lib/call-kind";
import { isInternalMeetingTitle, isInternalParticipantLabel } from "@/lib/call-intake";
import { isGenericMeetingTitle } from "@/lib/fathom-import";
import { samePersonName } from "@/lib/lead-match";
import { zonedParts } from "@/lib/crm-time";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const INTERNAL_SESSION =
  /\b(feedback|coaching|coach|role[\s-]?play|pr[aá]ctica|practica|sesi[oó]n interna)\b/i;

export function realClientName(value?: string | null) {
  const text = String(value || "").trim();
  if (!text || text === "—" || text === "-" || text.toLowerCase() === "null") return "";
  if (isGenericMeetingTitle(text) || isInternalParticipantLabel(text)) return "";
  return text;
}

function calendarDay(value?: string | Date | null) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [year, month, day] = value.trim().split("-").map(Number);
    return { year, month, day, time: "" };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = zonedParts(date);
  if (!parts.year) return null;
  const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  return { year: parts.year, month: parts.month, day: parts.day, time };
}

/** Last transcript timestamp, when it looks like a call duration and not a clock time. */
export function durationMinutesFromTranscript(text?: string | null) {
  const value = String(text || "");
  if (value.length < 20) return null;
  const sample = `${value.slice(0, 800)}\n${value.slice(-5000)}`;
  let max = 0;
  let sawStart = false;
  for (const match of sample.matchAll(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/g)) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = match[3] == null ? 0 : Number(match[3]);
    if (minutes > 59 || seconds > 59) continue;
    const total = match[3] == null ? hours * 60 + minutes : hours * 3600 + minutes * 60 + seconds;
    if (total <= 90) sawStart = true;
    if (total > max) max = total;
  }
  if (!sawStart || max < 60 || max > 6 * 3600) return null;
  return Math.max(1, Math.round(max / 60));
}

function summaryTitle(summary?: string | null) {
  let text = String(summary || "").replace(/\s+/g, " ").trim();
  if (text.length < 12 || /sin t[ií]tulo/i.test(text)) return "";
  text = text.replace(/^(?:hola|buenas|buenos d[ií]as|hey|ey)[,!.\s]+/i, "");
  const words = text.split(" ").filter(Boolean).slice(0, 8);
  if (words.length < 3) return "";
  const snippet = words.join(" ");
  return snippet.length > 72 ? `${snippet.slice(0, 69).trim()}…` : snippet;
}

/** Untitled calls: the lead if linked, otherwise the date and duration, or the summary. */
export function visibleCallTitle(args: {
  title?: string | null;
  leadName?: string | null;
  date?: string | Date | null;
  durationMinutes?: number | null;
  summary?: string | null;
}) {
  const lead = realClientName(args.leadName);
  const title = String(args.title || "").trim();
  const generic = !title || isGenericMeetingTitle(title);
  if (!generic) return title;
  if (lead) return lead;
  const when = calendarDay(args.date);
  if (when) {
    const month = MONTHS[when.month - 1] || "";
    const clock = when.time ? `, ${when.time}` : "";
    const minutes =
      args.durationMinutes && args.durationMinutes > 0
        ? ` · ${Math.round(args.durationMinutes)} min`
        : "";
    return `Llamada del ${when.day} ${month}${clock}${minutes}`;
  }
  return summaryTitle(args.summary) || "Llamada sin título";
}

export function linkedToCrmLead(name: string | null | undefined, leads: string[]) {
  const client = realClientName(name);
  if (!client) return false;
  return leads.some((lead) => samePersonName(lead, client));
}

export function joinDistinct(parts: Array<string | null | undefined>) {
  const out: string[] = [];
  for (const part of parts) {
    const text = String(part || "").trim();
    if (!text || text === "—") continue;
    if (out[out.length - 1] === text) continue;
    out.push(text);
  }
  return out.join(" · ");
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
