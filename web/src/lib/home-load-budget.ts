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
