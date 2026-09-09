export const FATHOM_SKIPPED = "skipped";
export const EMPTY_TRANSCRIPT_MARK = "[sin transcripción]";
export const DEFAULT_IMPORT_DAYS = 30;

export function defaultImportSinceDate() {
  const date = new Date();
  date.setDate(date.getDate() - DEFAULT_IMPORT_DAYS);
  return toDateInputValue(date);
}

export function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseImportSince(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = raw.includes("T")
    ? new Date(raw)
    : new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function isSkippedSession(practiceSessionId?: string | null) {
  return practiceSessionId === FATHOM_SKIPPED;
}

export function isUsableTranscript(text?: string | null) {
  const value = String(text || "").trim();
  return value.length >= 200 && value !== EMPTY_TRANSCRIPT_MARK;
}
