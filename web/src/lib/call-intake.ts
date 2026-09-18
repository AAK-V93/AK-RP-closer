import { isGenericMeetingTitle } from "@/lib/fathom-import";
import { parseCallTranscript } from "@/lib/parse-transcript";

export const MIN_SALES_DURATION_MS = 5 * 60 * 1000;

const INTERNAL_TITLE =
  /\b(stand[\s-]?up|daily\s*(scrum|sync)?|1\s*[:\-]\s*1|one[\s-]*on[\s-]*one|all[\s-]?hands|huddle|retrospectiv|sprint\s*planning|team\s*(sync|meeting|standup)|junta\s+de\s+equipo|reuni[oó]n\s+de\s+equipo|staff\s+meeting|weekly\s+sync|coaching\s+interno|internas?)\b/i;

const INTERNAL_PERSON =
  /^(equipo|team|staff|internal|interna|closers?|directivos?)$/i;

const CALENDAR_METADATA =
  /meet\.google\.com|zoom\.us\/j\/|hangoutLink|Join with Google Meet|Unirse a (Zoom|Google Meet)|Invitaci[oó]n de Google Calendar|Google Calendar:|BEGIN:VCALENDAR|conferenceData|hangouts\.google/i;

export type CallIntakeDecision =
  | { action: "extract"; durationMs: number | null }
  | {
      action: "skip";
      reason: "internal" | "short" | "no_transcript";
      estado: "INTERNA" | "NO_COMERCIAL";
    };

export function isInternalMeetingTitle(title?: string | null) {
  const value = String(title || "").trim();
  if (!value) return false;
  return INTERNAL_TITLE.test(value);
}

export function isInternalParticipantLabel(name?: string | null) {
  const value = String(name || "").trim();
  if (!value) return false;
  return INTERNAL_PERSON.test(value);
}

function clockToMs(stamp: string | null) {
  if (!stamp) return null;
  const parts = stamp.split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return null;
}

export function durationMsFromTranscript(text?: string | null) {
  const parsed = parseCallTranscript(String(text || ""));
  const stamps = parsed.lines
    .map((line) => clockToMs(line.timestamp))
    .filter((ms): ms is number => ms != null && ms > 0);
  if (stamps.length) return Math.max(...stamps);
  const mins = parsed.durationHint?.match(/(\d+)/);
  if (mins) return Number(mins[1]) * 60 * 1000;
  return null;
}

export function hasSpokenDialogue(text?: string | null) {
  const value = String(text || "").trim();
  if (!value) return false;
  const parsed = parseCallTranscript(value);
  const spoken = parsed.lines.filter((line) => line.text.trim().length >= 8);
  const named = spoken.filter(
    (line) =>
      line.speaker &&
      line.speaker !== "Llamada" &&
      !/^(hangoutLink|Event start|Join with|Location|Description|conferenceData|summary)$/i.test(
        line.speaker,
      ),
  );
  const speakers = new Set(named.map((line) => line.speaker));
  if (CALENDAR_METADATA.test(value)) {
    const stamped = named.filter((line) => Boolean(line.timestamp));
    const stampedSpeakers = new Set(stamped.map((line) => line.speaker));
    return stamped.length >= 2 && stampedSpeakers.size >= 1;
  }
  if (named.length >= 2 && speakers.size >= 2) return true;
  const withoutUrls = value.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  if (withoutUrls.length < 200) return false;
  const chunks = withoutUrls.split(/[.!?\n]/).filter((part) => part.trim().length > 24);
  return chunks.length >= 4;
}

export function isCalendarMetadataBlob(text?: string | null) {
  const value = String(text || "").trim();
  if (!value) return false;
  return CALENDAR_METADATA.test(value) && !hasSpokenDialogue(value);
}

/** Transcript with real talk, not Calendar/Meet event metadata. */
export function isRealTranscript(text?: string | null) {
  const value = String(text || "").trim();
  if (value.length < 80) return false;
  if (/^\[sin transcripci[oó]n\]$/i.test(value)) return false;
  if (isCalendarMetadataBlob(value)) return false;
  return hasSpokenDialogue(value);
}

export function classifyCallIntake(args: {
  title?: string | null;
  transcript?: string | null;
  durationMs?: number | null;
  participants?: string[] | null;
}) {
  if (isInternalMeetingTitle(args.title)) {
    return {
      action: "skip",
      reason: "internal",
      estado: "INTERNA",
    } satisfies CallIntakeDecision;
  }
  if ((args.participants || []).some((name) => isInternalParticipantLabel(name))) {
    return {
      action: "skip",
      reason: "internal",
      estado: "INTERNA",
    } satisfies CallIntakeDecision;
  }

  const duration =
    args.durationMs && args.durationMs > 0
      ? args.durationMs
      : durationMsFromTranscript(args.transcript);
  if (duration != null && duration < MIN_SALES_DURATION_MS) {
    return {
      action: "skip",
      reason: "short",
      estado: "NO_COMERCIAL",
    } satisfies CallIntakeDecision;
  }

  if (!isRealTranscript(args.transcript)) {
    return {
      action: "skip",
      reason: "no_transcript",
      estado: "NO_COMERCIAL",
    } satisfies CallIntakeDecision;
  }

  return { action: "extract", durationMs: duration } satisfies CallIntakeDecision;
}

export type CalendarAttendee = {
  email?: string;
  displayName?: string;
  self?: boolean;
  resource?: boolean;
  responseStatus?: string;
};

export function calendarEventDurationMs(args: {
  start?: { dateTime?: string; date?: string } | null;
  end?: { dateTime?: string; date?: string } | null;
}) {
  const start = args.start?.dateTime;
  const end = args.end?.dateTime;
  if (!start || !end) return null;
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return to - from;
}

export function externalCalendarLeadName(
  attendees?: CalendarAttendee[] | null,
) {
  const others = (attendees || []).filter(
    (row) => !row.self && !row.resource && row.responseStatus !== "declined",
  );
  const named = others.find((row) => row.displayName?.trim());
  if (named?.displayName) return named.displayName.trim().slice(0, 80);
  const email = others[0]?.email?.trim();
  if (!email) return null;
  return email.split("@")[0].replace(/[._]+/g, " ").slice(0, 80);
}

export function shouldKeepCalendarEvent(args: {
  title?: string | null;
  durationMs?: number | null;
  attendees?: CalendarAttendee[] | null;
  cancelled?: boolean;
}) {
  if (args.cancelled) return { keep: false as const, reason: "cancelled" };
  if (isInternalMeetingTitle(args.title)) {
    return { keep: false as const, reason: "internal" };
  }
  if (args.durationMs != null && args.durationMs < MIN_SALES_DURATION_MS) {
    return { keep: false as const, reason: "short" };
  }
  const attendeeName = externalCalendarLeadName(args.attendees);
  if (attendeeName && isInternalParticipantLabel(attendeeName)) {
    return { keep: false as const, reason: "internal" };
  }
  if (isGenericMeetingTitle(args.title) && !attendeeName) {
    return { keep: false as const, reason: "generic" };
  }
  return { keep: true as const, leadName: attendeeName || "" };
}
