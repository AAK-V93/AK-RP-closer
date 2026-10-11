// Rebuild window (plan 2.6): default 60 days, pending Kali. FATHOM_BACKFILL_DAYS
// overrides it (whole days, 1–365); anything else falls back to the default.
export const BACKFILL_WINDOW_DAYS = 60;

export function backfillWindowDays(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FATHOM_BACKFILL_DAYS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : BACKFILL_WINDOW_DAYS;
}
