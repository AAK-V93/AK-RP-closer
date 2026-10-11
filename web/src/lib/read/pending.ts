// Confirmar llamadas (plan 2.1, PR 6): 10 calls waiting, the brief's
// suggestions for them (who the person is) and the names to show. Never the
// brief itself: the «Pendiente de pago» label rides in the suggestion payload.
import type { Outcome } from "@/lib/ingest/brief";
import { type Db, iso } from "./dto";

export const PENDING_TAKE = 10;

export type PendingWho =
  | { kind: "lead"; leadId: string; name: string }
  | { kind: "new"; name: string }
  | { kind: "pick"; name: string | null; candidates: Array<{ id: string; name: string }> }
  | { kind: "ask" };

const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function readPending(db: Db, userId: string) {
  const calls = await db.call.findMany({
    where: { userId, state: "PENDING_CONFIRM" },
    orderBy: { recordedAt: "desc" },
    take: PENDING_TAKE,
    select: { id: true, leadId: true, offerId: true, title: true, recordedAt: true, durationSec: true, oneLine: true, suggestedOutcome: true, updatedAt: true },
  });
  if (!calls.length) return [];
  const ids = calls.map((c) => c.id);
  const suggestions = await db.proposedChange.findMany({
    where: { userId, callId: { in: ids }, origin: "BRIEF", status: "PENDING", kind: { in: ["CREATE_LEAD", "UPDATE_LEAD"] } },
    orderBy: { createdAt: "asc" },
    take: PENDING_TAKE * 2,
    select: { callId: true, kind: true, leadId: true, payload: true },
  });
  const byCall = new Map<string, { kind: string; leadId: string | null; payload: Record<string, unknown> }>();
  for (const s of suggestions) if (s.callId && !byCall.has(s.callId)) byCall.set(s.callId, { kind: s.kind, leadId: s.leadId, payload: obj(s.payload) });
  const leadIds = new Set<string>();
  for (const c of calls) if (c.leadId) leadIds.add(c.leadId);
  for (const s of byCall.values()) {
    if (s.leadId) leadIds.add(s.leadId);
    for (const id of Array.isArray(s.payload.possibleMatches) ? s.payload.possibleMatches : []) if (typeof id === "string") leadIds.add(id);
  }
  const offerIds = new Set<string>();
  for (const c of calls) if (c.offerId) offerIds.add(c.offerId);
  for (const s of byCall.values()) if (typeof s.payload.offerId === "string") offerIds.add(s.payload.offerId);
  const [leads, offers] = await Promise.all([
    leadIds.size
      ? db.lead.findMany({ where: { userId, id: { in: [...leadIds] } }, take: PENDING_TAKE * 4, select: { id: true, name: true, offerId: true } })
      : [],
    offerIds.size || leadIds.size
      ? db.offer.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, take: 30, select: { id: true, name: true } })
      : [],
  ]);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const offerName = new Map(offers.map((o) => [o.id, o.name]));
  return calls.map((c) => {
    const s = byCall.get(c.id);
    const lead = c.leadId ? leadById.get(c.leadId) : s?.kind === "UPDATE_LEAD" && s.leadId ? leadById.get(s.leadId) : undefined;
    const candidates = (Array.isArray(s?.payload.possibleMatches) ? (s!.payload.possibleMatches as unknown[]) : [])
      .map((id) => (typeof id === "string" ? leadById.get(id) : undefined))
      .filter((l): l is NonNullable<typeof l> => Boolean(l))
      .map((l) => ({ id: l.id, name: l.name }));
    const name = str(s?.payload.name);
    const who: PendingWho = lead
      ? { kind: "lead", leadId: lead.id, name: lead.name }
      : candidates.length
        ? { kind: "pick", name, candidates }
        : name
          ? { kind: "new", name }
          : { kind: "ask" };
    const offerId = lead?.offerId ?? str(s?.payload.offerId) ?? c.offerId;
    return {
      id: c.id,
      /** the card version: the same card tapped twice is one change */
      version: String(c.updatedAt.getTime()),
      title: c.title,
      recordedAt: iso(c.recordedAt)!,
      durationSec: c.durationSec,
      oneLine: c.oneLine,
      suggestedOutcome: c.suggestedOutcome as Outcome | null,
      offerName: offerId ? offerName.get(offerId) ?? null : null,
      who,
      pendingPayment: s?.payload.leadState === "pendiente_pago",
    };
  });
}
export type PendingCall = Awaited<ReturnType<typeof readPending>>[number];
