import { Prisma } from "@prisma/client";

/**
 * SQL pieces for call lists, so the database sends a number or a flag instead of the
 * transcript text (each transcript is ~40–60 KB; Neon Free allows 5 GB of transfer a month).
 */

/** Same timestamps durationMinutesFromTranscript (crm-noise.ts) reads: 1:23, 12:34 or 01:02:03. */
export const DURATION_TIMESTAMP_RE = String.raw`\y(\d{1,2}):(\d{2})(?::(\d{2}))?\y`;

/**
 * Minutes of the call, computed in Postgres exactly like durationMinutesFromTranscript:
 * looks at the first 800 + last 5000 characters, needs a timestamp near the start (≤ 90 s)
 * and a last one between 1 minute and 6 hours. NULL when it can't tell.
 */
export const DURATION_MINUTES_SQL = Prisma.sql`(
  SELECT CASE
    WHEN length("transcriptText") >= 20 AND bool_or(d.t <= 90) AND max(d.t) >= 60 AND max(d.t) <= 21600
    THEN greatest(1, round(max(d.t) / 60.0))::int
  END
  FROM (
    SELECT CASE WHEN m[3] IS NULL THEN m[1]::int * 60 + m[2]::int
                ELSE m[1]::int * 3600 + m[2]::int * 60 + m[3]::int END AS t
    FROM regexp_matches(left("transcriptText", 800) || chr(10) || right("transcriptText", 5000), ${DURATION_TIMESTAMP_RE}, 'g') AS m
    WHERE m[2]::int <= 59 AND coalesce(m[3]::int, 0) <= 59
  ) d
)`;

/** isUsableTranscript in SQL: at least 80 characters once trimmed, and not the «no transcript» mark. */
export function usableTranscriptSql(emptyMark: string) {
  return Prisma.sql`(length(btrim("transcriptText", E' \\t\\n\\r\\f\\v')) >= 80 AND "transcriptText" <> ${emptyMark})`;
}

/**
 * A copy of filingJson with only `keys` (and, optionally, only `nested` sub-keys of an object
 * key such as evidencia), built in Postgres. Missing keys stay missing and explicit nulls stay
 * null, so `Number(filing.x)` and `filing.x ?? y` behave exactly as with the whole JSON.
 */
export function filingSubsetSql(keys: readonly string[], nested: Record<string, readonly string[]> = {}) {
  const pick = (source: Prisma.Sql, names: readonly string[]) => Prisma.sql`COALESCE((
    SELECT jsonb_object_agg(k.key, k.value)
    FROM jsonb_each(CASE WHEN jsonb_typeof(${source}) = 'object' THEN ${source} ELSE '{}'::jsonb END) AS k
    WHERE k.key IN (${Prisma.join([...names])})
  ), '{}'::jsonb)`;
  const parts = [pick(Prisma.sql`"filingJson"`, keys)];
  for (const [key, names] of Object.entries(nested)) {
    parts.push(Prisma.sql`CASE WHEN jsonb_typeof("filingJson"->${key}) = 'object'
      THEN jsonb_build_object(${key}::text, ${pick(Prisma.sql`("filingJson"->${key})`, names)})
      ELSE COALESCE((SELECT jsonb_build_object(${key}::text, "filingJson"->${key}) WHERE jsonb_exists("filingJson", ${key}::text)), '{}'::jsonb) END`);
  }
  return Prisma.join(parts, " || ");
}

/** Raw rows may bring the projected JSON as text; give callers an object either way. */
export function filingObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The filing keys a call list needs to tell whether the person is already in the CRM
 * (callAlreadyInCrm / filingLeadId), instead of the whole filingJson (evidence, confidence, undo…).
 */
export const TAG_FILING_SQL = filingSubsetSql(["lead_id", "cliente_real", "telefono", "email", "notas_crm", "summary"]);
