// Confirmar (PR 6): what the panel shows besides the pending list. Read on
// each visit of the panel (not cached): the saved cards come from the URL.
import { parseBrief } from "@/lib/ingest/brief";
import { dealDefaults } from "@/lib/confirm/choice";
import { type Db, iso } from "./dto";

export const IGNORED_TAKE = 10;

/** Cards saved in this visit (ids from the URL): green with «Guardado» and «Deshacer». */
export async function readSaved(db: Db, userId: string, callIds: string[]) {
  const ids = [...new Set(callIds)].filter((id) => /^[\w-]{1,64}$/.test(id)).slice(0, 10);
  if (!ids.length) return [];
  const [calls, changes] = await Promise.all([
    db.call.findMany({
      where: { userId, id: { in: ids }, state: "CONFIRMED" },
      take: 10,
      select: { id: true, title: true, recordedAt: true, leadId: true, lead: { select: { name: true } } },
    }),
    db.proposedChange.findMany({
      where: { userId, callId: { in: ids }, kind: "CONFIRM_CALL", status: "APPLIED" },
      orderBy: { decidedAt: "desc" },
      take: 10,
      select: { id: true, callId: true, preview: true },
    }),
  ]);
  const change = new Map<string, { id: string; preview: string }>();
  for (const c of changes) if (c.callId && !change.has(c.callId)) change.set(c.callId, { id: c.id, preview: c.preview });
  return ids
    .map((id) => calls.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c && change.has(c.id)))
    .map((c) => ({
      id: c.id,
      name: c.lead?.name ?? c.title,
      recordedAt: iso(c.recordedAt)!,
      changeId: change.get(c.id)!.id,
      saved: change.get(c.id)!.preview,
    }));
}

/** «Ignoradas (N)»: calls the brief read as internal, newest first. */
export async function readIgnored(db: Db, userId: string) {
  const rows = await db.call.findMany({
    where: { userId, state: "IGNORED" },
    orderBy: { recordedAt: "desc" },
    take: IGNORED_TAKE,
    select: { id: true, title: true, recordedAt: true, durationSec: true, oneLine: true },
  });
  return rows.map((r) => ({ ...r, recordedAt: iso(r.recordedAt)! }));
}

/** «Cerró» form defaults for ONE call: only amounts the brief cites. */
export async function readDealDefaults(db: Db, userId: string, callId: string) {
  const call = await db.call.findFirst({ where: { id: callId, userId, state: "PENDING_CONFIRM" }, select: { brief: true } });
  const brief = call?.brief ? parseBrief(JSON.stringify(call.brief)) : null;
  return dealDefaults(brief);
}
