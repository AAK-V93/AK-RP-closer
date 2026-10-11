// Lead history (plan 2.2, Arquitectura PR 6 review): LeadEvent is append-only.
// «Deshacer» never deletes or edits an event: it inserts a compensating UNDO
// event and marks the original with undoneAt / undoneByEventId in the same
// single statement. Every count and read skips events with undoneAt set.
//
// Intentos (Kali's 6–10 rule): «No contestó» and «Hecho» are ATTEMPT events;
// Lead.attemptsSinceLastCall is recounted from the live (not undone) ones.
import { createHash, randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { WRITE_EFFECTS } from "@/lib/read/tags";
import { bogotaDay, bogotaMonth } from "@/lib/time/bogota";
import { invalidate } from "./invalidate";
import type { WriteOpts, WriteResult } from "./offers";
import { recount } from "./recount";

type Db = PrismaClient;
const ts = (d: Date) => d.toISOString().replace("Z", "");

/** id of the UNDO event that compensates `eventId` (deterministic: a retry inserts nothing twice) */
export const undoEventId = (eventId: string) => `undo_${eventId}`.slice(0, 64);

/**
 * Compensates the live events of one change (or one event) in ONE statement:
 * inserts the UNDO events and sets undoneAt / undoneByEventId on the originals.
 * Idempotent: an event already undone is not selected again.
 */
export async function compensateEvents(
  db: Pick<PrismaClient, "$executeRaw">,
  userId: string,
  target: { leadId: string; proposedChangeId: string } | { leadId: string; eventId: string },
  now: Date,
) {
  const changeId = "proposedChangeId" in target ? target.proposedChangeId : null;
  const eventId = "eventId" in target ? target.eventId : null;
  return db.$executeRaw`
    WITH orig AS (
      SELECT e.id, e."callId", e."proposedChangeId", e.type, e."attemptResult" FROM "LeadEvent" e
      WHERE e."userId" = ${userId} AND e."leadId" = ${target.leadId} AND e."undoneAt" IS NULL AND e.type <> 'UNDO'
        AND (${changeId}::text IS NULL OR e."proposedChangeId" = ${changeId})
        AND (${eventId}::text IS NULL OR e.id = ${eventId})
    ), ins AS (
      INSERT INTO "LeadEvent" ("id", "userId", "leadId", "at", "type", "callId", "proposedChangeId", "note")
      SELECT 'undo_' || o.id, ${userId}, ${target.leadId}, ${ts(now)}::timestamp, 'UNDO', o."callId", o."proposedChangeId",
        left('Deshecho: ' || o.type::text || COALESCE(' ' || o."attemptResult"::text, ''), 300)
      FROM orig o
      ON CONFLICT ("id") DO NOTHING
    )
    UPDATE "LeadEvent" e SET "undoneAt" = ${ts(now)}::timestamp, "undoneByEventId" = 'undo_' || e.id
    FROM orig WHERE e.id = orig.id AND e."undoneAt" IS NULL
  `;
}

export type AttemptResult = "NO_CONTESTO" | "RESPONDIO" | "ENVIADO";
export type AttemptInput = {
  leadId: string;
  result: AttemptResult;
  channel?: "WHATSAPP" | "LLAMADA" | "EMAIL" | "OTRO" | null;
  note?: string | null;
  scriptId?: string | null;
  /** form token: the same tap twice logs one attempt */
  eventId?: string | null;
};

/** «No contestó» / «Hecho»: one ATTEMPT event, then the lead's counter and the month are recounted. */
export async function logAttempt(db: Db, userId: string, input: AttemptInput, opts: WriteOpts = {}): Promise<WriteResult<{ eventId: string }>> {
  const now = opts.now ?? new Date();
  const lead = await db.lead.findFirst({ where: { id: input.leadId, userId }, select: { id: true, offerId: true } });
  if (!lead) return { ok: false, error: "No encontré a esa persona." };
  // the id comes from (user, form token): the same tap twice is one row, and a token can never touch another user's row
  const eventId = input.eventId && /^[\w-]{8,64}$/.test(input.eventId)
    ? `att_${createHash("sha256").update(`${userId}:${input.eventId}`).digest("hex").slice(0, 32)}`
    : randomUUID();
  const note = input.note?.trim() ? input.note.trim().slice(0, 300) : null;
  await db.$executeRaw`
    INSERT INTO "LeadEvent" ("id", "userId", "leadId", "at", "type", "attemptResult", "channel", "scriptId", "note")
    SELECT ${eventId}, ${userId}, l.id, ${ts(now)}::timestamp, 'ATTEMPT', ${input.result}::"AttemptResult",
      ${input.channel ?? null}::"ContactChannel", ${input.scriptId ?? null}, ${note}
    FROM "Lead" l WHERE l.id = ${lead.id} AND l."userId" = ${userId}
    ON CONFLICT ("id") DO NOTHING
  `;
  await recount(db, userId, { today: bogotaDay(now), months: [bogotaMonth(now)], offerId: lead.offerId, leadId: lead.id });
  invalidate(userId, WRITE_EFFECTS.logAttempt(lead.id), opts.revalidate);
  return { ok: true, eventId };
}

/** «Deshacer» of an attempt: compensating UNDO event, the attempt stays in the history marked as undone. */
export async function undoAttempt(db: Db, userId: string, eventId: string, opts: WriteOpts = {}): Promise<WriteResult<{ leadId: string }>> {
  const now = opts.now ?? new Date();
  const ev = await db.leadEvent.findFirst({
    where: { id: eventId, userId, type: "ATTEMPT" },
    select: { leadId: true, at: true, undoneAt: true, lead: { select: { offerId: true } } },
  });
  if (!ev) return { ok: false, error: "No encontré ese intento." };
  if (!ev.undoneAt) await compensateEvents(db, userId, { leadId: ev.leadId, eventId }, now);
  await recount(db, userId, { today: bogotaDay(now), months: [bogotaMonth(ev.at)], offerId: ev.lead.offerId, leadId: ev.leadId });
  invalidate(userId, WRITE_EFFECTS.undoAttempt(ev.leadId), opts.revalidate);
  return { ok: true, leadId: ev.leadId };
}
