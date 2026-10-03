/**
 * Critical-path database round trips for a cold first paint of Inicio,
 * before the CRM dashboard's own queries. 40 ms is a typical Neon HTTP hop.
 * The old path ran every schema statement in series. The new path probes the
 * newest tables (two statements, and the four schemas overlap) and skips DDL
 * when they are already there.
 */
export const SCHEMA_STATEMENTS = {
  workspace: 11,
  fathom: 14,
  crm: 59,
  coach: 3,
} as const;

export function coldHomeBudgetMs(rttMs: number) {
  const schemaSerial =
    SCHEMA_STATEMENTS.workspace +
    SCHEMA_STATEMENTS.fathom +
    SCHEMA_STATEMENTS.crm +
    SCHEMA_STATEMENTS.coach;
  const before =
    rttMs + // browser waits for /api/auth/session before the hub request
    schemaSerial * rttMs +
    6 * rttMs + // getHomeState, one query after another
    rttMs + // user prefs after that
    rttMs + // workspace after prefs
    rttMs; // dashboard after workspace
  const after =
    2 * rttMs + // schema probes overlap; the slowest pair is two statements
    rttMs + // home queries and prefs in one wave
    rttMs; // workspace and dashboard in one wave
  return { before, after, schemaSerial };
}

/** Segments of GET /api/hub. Durations are milliseconds on the critical path. */
export type HubSegmentMs = {
  prisma: number;
  ensure: number;
  home: number;
  prefs: number;
  dashboard: number;
  filings: number;
  thread: number;
  projection: number;
};

/**
 * Wall clock before this batch. Home and prefs finished, then the CRM wave,
 * then a projection query. The thread overlapped that snapshot.
 */
export function hubTtfbBefore(s: HubSegmentMs) {
  const snapshot = s.home + s.prefs + Math.max(s.dashboard, s.filings) + s.projection;
  return s.prisma + s.ensure + Math.max(snapshot, s.thread);
}

/** One wave after this batch. Projection is computed in memory. */
export function hubTtfbAfter(s: HubSegmentMs) {
  return s.prisma + s.ensure + Math.max(s.home, s.prefs, s.dashboard, s.filings, s.thread);
}

/**
 * QA on 6f6de19: TTFB 650–700, dashboard 275, filings 185, thread 157, calls 124.
 * The 400 ms beside the dashboard is the serial prefix (prisma, ensure, home
 * with the transcript body, prefs, projection). After, home joins the wave
 * without the transcript, filings and the thread shrink, and projection is 0.
 */
export const HUB_PAINT_BEFORE: HubSegmentMs = {
  prisma: 70,
  ensure: 55,
  home: 160,
  prefs: 35,
  dashboard: 275,
  filings: 185,
  thread: 157,
  projection: 80,
};

export const HUB_PAINT_AFTER: HubSegmentMs = {
  prisma: 70,
  ensure: 55,
  home: 45,
  prefs: 35,
  dashboard: 190,
  filings: 90,
  thread: 40,
  projection: 0,
};
