// Ficha (plan 2.1). Never selects CallTranscript or summaryEn. The brief is
// read only when «Ver todo» opens. Message ideas arrive in PR 8.
import { type Db, amount, iso } from "./dto";

export const FICHA_ATTEMPTS_TAKE = 10;
export const FICHA_CALLS_TAKE = 10;

export async function readFicha(db: Db, userId: string, leadId: string) {
  const [lead, attempts] = await Promise.all([
    db.lead.findFirst({
      where: { id: leadId, userId },
      select: {
        id: true,
        name: true,
        offerId: true,
        phone: true,
        email: true,
        status: true,
        oneLine: true,
        whereLeft: true,
        missing: true,
        decider: true,
        lastCallAt: true,
        lastContactAt: true,
        nextContactAt: true,
        nextMeetingAt: true,
        closedAt: true,
        lostAt: true,
        attemptsSinceLastCall: true,
        potentialCommission: true,
        currency: true,
        createdAt: true,
        lastCall: { select: { id: true, recordedAt: true, durationSec: true } },
      },
    }),
    // newest 10 attempts; those after the last call are a prefix of this list
    db.leadEvent.findMany({
      where: { leadId, userId, type: "ATTEMPT" },
      orderBy: { at: "desc" },
      take: FICHA_ATTEMPTS_TAKE,
      select: { at: true, attemptResult: true, channel: true, note: true },
    }),
  ]);
  if (!lead) return null;
  const since = lead.lastCallAt ?? lead.createdAt;
  return {
    ...lead,
    lastCallAt: iso(lead.lastCallAt),
    lastContactAt: iso(lead.lastContactAt),
    nextContactAt: iso(lead.nextContactAt),
    nextMeetingAt: iso(lead.nextMeetingAt),
    closedAt: iso(lead.closedAt),
    lostAt: iso(lead.lostAt),
    createdAt: iso(lead.createdAt),
    potentialCommission: amount(lead.potentialCommission),
    lastCall: lead.lastCall
      ? { id: lead.lastCall.id, recordedAt: iso(lead.lastCall.recordedAt), durationSec: lead.lastCall.durationSec }
      : null,
    attempts: attempts
      .filter((a) => a.at > since)
      .map((a) => ({ ...a, at: iso(a.at) })),
  };
}

/** «Ver todo»: brief of the last call + the lead's calls (no brief, no transcript). */
export async function readFichaDetail(db: Db, userId: string, leadId: string) {
  const [last, calls] = await Promise.all([
    db.call.findFirst({
      where: { userId, lastCallOf: { some: { id: leadId, userId } } },
      select: { id: true, brief: true, briefVersion: true },
    }),
    db.call.findMany({
      where: { userId, leadId },
      orderBy: { recordedAt: "desc" },
      take: FICHA_CALLS_TAKE,
      select: { id: true, recordedAt: true, durationSec: true, oneLine: true, outcome: true, state: true },
    }),
  ]);
  return {
    brief: last?.briefVersion ? last.brief : null,
    calls: calls.map((c) => ({ ...c, recordedAt: iso(c.recordedAt) })),
  };
}
