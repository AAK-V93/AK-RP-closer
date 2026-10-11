// What a case shows: the person's correction if any, else what was read.
import type { CaseFields } from "./items";

export type CaseRow = {
  nameExtracted: string;
  profileExtracted: string | null;
  beforeExtracted: string | null;
  resultExtracted: string | null;
  quoteExtracted: string | null;
  mediaUrlExtracted: string | null;
  nameUser: string | null;
  profileUser: string | null;
  beforeUser: string | null;
  resultUser: string | null;
  quoteUser: string | null;
  mediaUrlUser: string | null;
  confirmedAt: string | Date | null;
  dismissed: boolean;
  missingFromSourceAt: string | Date | null;
};

export function caseFields(row: CaseRow): CaseFields {
  return {
    name: row.nameUser ?? (row.nameExtracted || null),
    profile: row.profileUser ?? row.profileExtracted,
    before: row.beforeUser ?? row.beforeExtracted,
    result: row.resultUser ?? row.resultExtracted,
    quote: row.quoteUser ?? row.quoteExtracted,
    mediaUrl: row.mediaUrlUser ?? row.mediaUrlExtracted,
  };
}

export function extractedFields(row: CaseRow): CaseFields {
  return {
    name: row.nameExtracted || null,
    profile: row.profileExtracted,
    before: row.beforeExtracted,
    result: row.resultExtracted,
    quote: row.quoteExtracted,
    mediaUrl: row.mediaUrlExtracted,
  };
}

/** A case may be suggested in messages or practice only once confirmed and still in its source. */
export function isSuggestible(row: Pick<CaseRow, "confirmedAt" | "dismissed" | "missingFromSourceAt">) {
  return Boolean(row.confirmedAt) && !row.dismissed && !row.missingFromSourceAt;
}

/**
 * What «Guardar» writes for one field: the typed value only when it differs
 * from what was read (null = keep showing the extracted one).
 */
export function userValue(typed: string | null | undefined, extracted: string | null) {
  const t = typed?.trim() ?? "";
  if (t === (extracted ?? "").trim()) return null;
  return t;
}
