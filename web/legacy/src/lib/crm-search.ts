import { zonedDayKey } from "@/lib/crm-time";
import { personLikeTitle } from "@/lib/plain-labels";
import { foldLeadName } from "@/lib/crm-followups";

/** Fathom recordings whose title is a person's name → one search entry per person (newest call). */
export function outsideCrmPeople(rows: readonly { id: string; title: string; recordedAt?: Date | string | null }[]) {
  const seen = new Set<string>();
  const out: { id: string; name: string; day: string }[] = [];
  for (const row of rows) {
    const name = personLikeTitle(row.title);
    const key = foldLeadName(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    const at = row.recordedAt ? new Date(row.recordedAt) : null;
    out.push({ id: row.id, name, day: at && Number.isFinite(at.getTime()) ? zonedDayKey(at) : "" });
  }
  return out;
}
