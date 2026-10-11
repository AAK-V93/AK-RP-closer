// Confirmar llamadas (plan 2.1): 10 calls waiting, then their lead names.
import { type Db, iso } from "./dto";

export const PENDING_TAKE = 10;

export async function readPending(db: Db, userId: string) {
  const calls = await db.call.findMany({
    where: { userId, state: "PENDING_CONFIRM" },
    orderBy: { recordedAt: "desc" },
    take: PENDING_TAKE,
    select: { id: true, leadId: true, offerId: true, recordedAt: true, durationSec: true, oneLine: true, suggestedOutcome: true },
  });
  const leadIds = [...new Set(calls.map((c) => c.leadId).filter((id): id is string => Boolean(id)))];
  const leads = leadIds.length
    ? await db.lead.findMany({
        where: { userId, id: { in: leadIds } },
        take: PENDING_TAKE,
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(leads.map((l) => [l.id, l.name]));
  return calls.map((c) => ({
    ...c,
    recordedAt: iso(c.recordedAt),
    leadName: c.leadId ? names.get(c.leadId) ?? null : null,
  }));
}
