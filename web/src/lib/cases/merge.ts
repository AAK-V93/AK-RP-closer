// Re-sync rules (revision-arquitecto-casos-exito.md):
// - new key → insert with *Extracted only;
// - known key whose extraction or snippet changed → update *Extracted + snippet only;
// - *User, dismissed and confirmedAt are never touched by a sync;
// - a key of this source that is gone → missingFromSourceAt (the row stays);
// - a key that comes back → missingFromSourceAt cleared.
import type { CaseFields } from "./items";

export type ExtractedCase = { externalKey: string; snippet: string; fields: CaseFields };

export type ExistingCase = {
  id: string;
  externalKey: string;
  sourceId: string | null;
  sourceSnippet: string | null;
  missingFromSourceAt: string | Date | null;
  extracted: CaseFields;
};

export type SyncPlan = {
  inserts: ExtractedCase[];
  updates: Array<{ id: string; snippet: string; fields: CaseFields }>;
  missing: string[];
  back: string[];
  unchanged: number;
};

const FIELDS: (keyof CaseFields)[] = ["name", "profile", "before", "result", "quote", "mediaUrl"];

function sameFields(a: CaseFields, b: CaseFields) {
  return FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null));
}

/** existing = cases of the offer (any source); only this source's rows can go missing. */
export function planSync(sourceId: string, existing: ExistingCase[], incoming: ExtractedCase[]): SyncPlan {
  const byKey = new Map(existing.map((c) => [c.externalKey, c]));
  const incomingKeys = new Set(incoming.map((c) => c.externalKey));
  const plan: SyncPlan = { inserts: [], updates: [], missing: [], back: [], unchanged: 0 };
  for (const item of incoming) {
    const row = byKey.get(item.externalKey);
    if (!row) {
      plan.inserts.push(item);
      continue;
    }
    if (row.missingFromSourceAt) plan.back.push(row.id);
    if (row.sourceSnippet === item.snippet && sameFields(row.extracted, item.fields)) plan.unchanged += 1;
    else plan.updates.push({ id: row.id, snippet: item.snippet, fields: item.fields });
  }
  for (const row of existing) {
    if (row.sourceId === sourceId && !incomingKeys.has(row.externalKey) && !row.missingFromSourceAt) {
      plan.missing.push(row.id);
    }
  }
  return plan;
}
