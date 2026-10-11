// «Confirmar llamadas» (PR 6, plan 1.1 ProposedChange + 2.2). Every write that
// is not a direct tap is a ProposedChange; a tap in Confirmar creates ONE change
// of kind CONFIRM_CALL and applies it with applyProposedChange, the only
// function that applies changes. «Deshacer» is undoProposedChange.
//
// Neon HTTP: no interactive transactions, so each step is ONE statement with
// ownership in the WHERE, and each is idempotent:
// - the change row has a unique idempotencyKey (a double tap inserts nothing);
// - applying claims the row PENDING → APPLIED in one UPDATE that also stores the
//   undo snapshot, so only one request runs the effects;
// - every row the change creates (Lead, LeadEvent, Deal, FollowUpTask) carries
//   its id or proposedChangeId, so a retry or an undo finds exactly those rows;
// - numbers are recounted from the source tables (recount.ts), never ±1, so
//   after «Deshacer» they are exactly what they were.
import { randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { type Outcome, parseBrief } from "@/lib/ingest/brief";
import { PENDING_PAYMENT_LABEL, briefDay, briefTime, savedText } from "@/lib/confirm/choice";
import { centsToAmount, commissionForDeal, perCloseCommission } from "@/lib/metrics";
import { WRITE_EFFECTS } from "@/lib/read/tags";
import { normalizeName } from "@/lib/text/name-norm";
import { type DayKey, bogotaDay, bogotaMonth, startOfDayInstant } from "@/lib/time/bogota";
import { invalidate } from "./invalidate";
import { type WriteOpts, parseAmount } from "./offers";
import { compensateEvents } from "./events";
import { recount } from "./recount";

type Db = PrismaClient;

/** timestamp(3) columns hold UTC wall time (same convention as recount.ts) */
const ts = (d: Date) => d.toISOString().replace("Z", "");
const tsIso = (iso: string | null) => (iso ? iso.replace("Z", "") : null);
const isoOf = (d: Date | null) => (d ? d.toISOString() : null);
const money = (cents: number | null) => (cents === null ? null : centsToAmount(cents).toFixed(2));

export type PaymentMode = "CONTADO" | "CUOTAS";

export type ConfirmChoice = {
  callId: string;
  /** Call.updatedAt (ms) of the card that was tapped: the same card tapped twice is one change */
  version: string;
  outcome: Outcome;
  /** «¿Quién es?»: "lead:<id>" or "new"; empty = what the brief proposed */
  who?: string | null;
  /** the name to create when the brief has none */
  name?: string | null;
  /** «Cerró»: monto y forma de pago; empty = «no sé todavía» */
  deal?: { amountTotal?: string | null; cashCollected?: string | null; paymentMode?: PaymentMode | null } | null;
};

type LeadStatus = "SEGUIMIENTO" | "CERRADO" | "PERDIDO";

export type ConfirmPayload = {
  callId: string;
  outcome: Outcome;
  recordedAt: string;
  leadId: string;
  createLead: null | { name: string; email: string | null; phone: string | null };
  offerId: string | null;
  /** currency of potentialCommission (the offer's) */
  currency: string;
  potentialCommission: string | null;
  fields: { oneLine: string | null; whereLeft: string | null; decider: string | null; lostReason: string | null };
  /** brief said «pendiente_pago» and the closer kept it in follow-up → COBRAR task */
  pendingPayment: boolean;
  /** day from the brief's próximo seguimiento, if it gave one */
  followDay: string | null;
  /** «HH:mm» (Bogotá) when the brief gave a time too; only used for the REUNION task */
  followTime?: string | null;
  deal: null | { amountTotal: string | null; cashCollected: string | null; paymentMode: PaymentMode | null; commissionAmount: string | null; currency: string };
  /** the brief's suggestions for this call: the ones the tap agreed with, and the rest */
  briefApplied: string[];
  briefRejected: string[];
};

const LEAD_SNAPSHOT = {
  id: true, status: true, closedAt: true, lostAt: true, lostReason: true, lastCallId: true, lastCallAt: true,
  lastContactAt: true, nextContactAt: true, nextMeetingAt: true, needsMeetingDate: true, oneLine: true, whereLeft: true, decider: true,
  offerId: true, potentialCommission: true, currency: true,
} as const;

type LeadSnapshot = {
  status: LeadStatus; closedAt: string | null; lostAt: string | null; lostReason: string | null;
  lastCallId: string | null; lastCallAt: string | null; lastContactAt: string | null; nextContactAt: string | null;
  nextMeetingAt: string | null; needsMeetingDate?: boolean; oneLine: string | null; whereLeft: string | null; decider: string | null;
  offerId: string | null; potentialCommission: string | null; currency: string;
};

export type ConfirmUndo = {
  call: { outcome: Outcome | null; confirmedAt: string | null; leadId: string | null; offerId: string | null };
  /** null: the lead was created by this change */
  lead: LeadSnapshot | null;
  /** an OPEN task the COBRAR / REUNION task replaced */
  prevOpenTaskId: string | null;
  /** months and offers whose numbers the change touched (recounted again on undo) */
  months: DayKey[];
  offerIds: string[];
};

export type ConfirmResult =
  | { ok: true; changeId: string | null; leadId: string | null; already?: boolean }
  | { ok: false; error: string };

const STATUS_OF: Record<Outcome, LeadStatus> = { CERRO: "CERRADO", PERDIDO: "PERDIDO", SEGUIMIENTO: "SEGUIMIENTO", REAGENDAR: "SEGUIMIENTO" };

type BriefChange = { id: string; kind: string; leadId: string | null; payload: unknown };
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * One tap in «Llamadas por confirmar». Creates the CONFIRM_CALL change (once per
 * card version) and applies it. Never creates a person blindly: with several
 * candidates the closer has to pick («¿Quién es?»).
 */
export async function confirmCall(db: Db, userId: string, choice: ConfirmChoice, opts: WriteOpts = {}): Promise<ConfirmResult> {
  const now = opts.now ?? new Date();
  const call = await db.call.findFirst({
    where: { id: choice.callId, userId },
    select: { id: true, state: true, recordedAt: true, brief: true, offerId: true, leadId: true },
  });
  if (!call) return { ok: false, error: "No encontré esa llamada." };
  if (call.state === "CONFIRMED") return { ok: true, changeId: null, leadId: call.leadId, already: true };
  if (call.state !== "PENDING_CONFIRM") return { ok: false, error: "Esta llamada ya no está por confirmar." };
  if (!/^\d{1,16}$/.test(choice.version)) return { ok: false, error: "Vuelve a abrir la lista y toca otra vez." };

  const brief = call.brief ? parseBrief(JSON.stringify(call.brief)) : null;
  const suggestions: BriefChange[] = await db.proposedChange.findMany({
    where: { userId, callId: call.id, origin: "BRIEF", status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: { id: true, kind: true, leadId: true, payload: true },
  });
  const update = suggestions.find((s) => s.kind === "UPDATE_LEAD" && s.leadId) ?? null;
  const create = suggestions.find((s) => s.kind === "CREATE_LEAD") ?? null;
  const proposed = obj((update ?? create)?.payload);
  const candidates = Array.isArray(obj(create?.payload).possibleMatches) ? (obj(create?.payload).possibleMatches as string[]) : [];

  // «¿Quién es?»
  const who = (choice.who ?? "").trim();
  let leadId: string | null = null;
  let newName: string | null = null;
  if (who.startsWith("lead:")) leadId = who.slice(5);
  else if (who === "new") newName = strOrNull(choice.name) ?? strOrNull(proposed.name) ?? brief?.cliente_real ?? null;
  else if (update) leadId = update.leadId;
  else if (call.leadId) leadId = call.leadId;
  else if (create && !candidates.length) newName = strOrNull(proposed.name);
  else if (!create && strOrNull(choice.name)) newName = strOrNull(choice.name);
  if (!leadId && !newName) {
    return { ok: false, error: candidates.length ? "Elige quién es antes de guardar." : "Escribe cómo se llama esta persona." };
  }
  const existing = leadId
    ? await db.lead.findFirst({ where: { id: leadId, userId }, select: { id: true, offerId: true } })
    : null;
  if (leadId && !existing) return { ok: false, error: "No encontré a esa persona." };

  const offerId = existing?.offerId ?? strOrNull(proposed.offerId) ?? call.offerId ?? null;
  const [offer, user] = await Promise.all([
    offerId
      ? db.offer.findFirst({ where: { id: offerId, userId }, select: { commissionType: true, commissionValue: true, priceCash: true, currency: true } })
      : null,
    db.user.findUnique({ where: { id: userId }, select: { currency: true } }),
  ]);
  const currency = offer?.currency ?? user?.currency ?? "USD";

  let deal: ConfirmPayload["deal"] = null;
  if (choice.outcome === "CERRO") {
    let amountTotal: string | null;
    let cashCollected: string | null;
    try {
      amountTotal = parseAmount(choice.deal?.amountTotal);
      cashCollected = parseAmount(choice.deal?.cashCollected);
    } catch {
      return { ok: false, error: "Revisa el monto: escribe solo el número, por ejemplo 1500." };
    }
    const commission = offer ? commissionForDeal(offer, { amountTotal, cashCollected }) : null;
    deal = { amountTotal, cashCollected, paymentMode: choice.deal?.paymentMode ?? null, commissionAmount: money(commission), currency };
  }

  const pendingPayment = choice.outcome === "SEGUIMIENTO" && brief?.estado_lead === "pendiente_pago";
  const finalLeadId = leadId ?? randomUUID();
  const agreed = new Set<string>();
  for (const s of suggestions) {
    if (s.kind === "UPDATE_LEAD" && s.leadId === leadId) agreed.add(s.id);
    if (s.kind === "CREATE_LEAD" && !leadId) agreed.add(s.id);
    if (s.kind === "SET_STATUS" && obj(s.payload).status === STATUS_OF[choice.outcome]) agreed.add(s.id);
  }
  const payload: ConfirmPayload = {
    callId: call.id,
    outcome: choice.outcome,
    recordedAt: call.recordedAt.toISOString(),
    leadId: finalLeadId,
    createLead: leadId ? null : { name: newName!.slice(0, 120), email: strOrNull(proposed.email), phone: strOrNull(proposed.phone) },
    offerId,
    currency,
    potentialCommission: offer ? money(perCloseCommission(offer).cents) : null,
    fields: {
      oneLine: strOrNull(proposed.oneLine) ?? brief?.una_linea ?? null,
      whereLeft: strOrNull(proposed.whereLeft) ?? brief?.acuerdo_seguimiento ?? null,
      decider: strOrNull(proposed.decider),
      lostReason: choice.outcome === "PERDIDO" ? brief?.razon_no_cierre ?? null : null,
    },
    pendingPayment,
    followDay: briefDay(brief?.proximo_seguimiento),
    followTime: briefTime(brief?.proximo_seguimiento),
    deal,
    briefApplied: suggestions.filter((s) => agreed.has(s.id)).map((s) => s.id),
    briefRejected: suggestions.filter((s) => !agreed.has(s.id)).map((s) => s.id),
  };
  const key = `confirm:${call.id}:${choice.version}`;
  await db.$executeRaw`
    INSERT INTO "ProposedChange" ("id", "userId", "leadId", "callId", "origin", "kind", "payload", "preview", "status", "idempotencyKey", "createdAt")
    VALUES (gen_random_uuid()::text, ${userId}, ${leadId}, ${call.id}, 'CONFIRM', 'CONFIRM_CALL',
      ${JSON.stringify(payload)}::jsonb, ${savedText(choice.outcome, pendingPayment, choice.outcome === "REAGENDAR" && !payload.followDay)}, 'PENDING', ${key}, now())
    ON CONFLICT ("idempotencyKey") DO NOTHING
  `;
  const change = await db.proposedChange.findFirst({ where: { idempotencyKey: key, userId }, select: { id: true } });
  if (!change) return { ok: false, error: "No pude guardar. Prueba de nuevo." };
  const applied = await applyProposedChange(db, userId, change.id, { ...opts, now });
  if (!applied.ok) return applied;
  invalidate(userId, WRITE_EFFECTS.confirmCall(applied.leadId), opts.revalidate);
  return { ...applied, changeId: change.id };
}

/**
 * Applies one ProposedChange. Idempotent: a second call (double tap, retry)
 * finds it no longer PENDING and does nothing. Today it applies CONFIRM_CALL;
 * the chat and the ficha bring their kinds later.
 */
export async function applyProposedChange(db: Db, userId: string, changeId: string, opts: WriteOpts = {}): Promise<ConfirmResult> {
  const now = opts.now ?? new Date();
  const change = await db.proposedChange.findFirst({
    where: { id: changeId, userId },
    select: { id: true, kind: true, status: true, payload: true },
  });
  if (!change) return { ok: false, error: "No encontré ese cambio." };
  if (change.kind !== "CONFIRM_CALL") return { ok: false, error: "Ese cambio todavía no se puede guardar desde aquí." };
  const p = change.payload as unknown as ConfirmPayload;
  if (change.status !== "PENDING") return { ok: true, changeId, leadId: p.leadId, already: true };

  const taskKind = changeTask(p);
  const [call, lead, openTask] = await Promise.all([
    db.call.findFirst({ where: { id: p.callId, userId }, select: { state: true, outcome: true, confirmedAt: true, leadId: true, offerId: true } }),
    db.lead.findFirst({ where: { id: p.leadId, userId }, select: LEAD_SNAPSHOT }),
    taskKind
      ? db.followUpTask.findFirst({ where: { userId, leadId: p.leadId, status: "OPEN" }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  if (!call || call.state !== "PENDING_CONFIRM") {
    // another change confirmed this call first: this one is stale
    await db.$executeRaw`
      UPDATE "ProposedChange" SET "status" = 'EXPIRED', "decidedAt" = now()
      WHERE "id" = ${changeId} AND "userId" = ${userId} AND "status" = 'PENDING'
    `;
    return { ok: true, changeId, leadId: call?.leadId ?? null, already: true };
  }
  if (!lead && !p.createLead) return { ok: false, error: "No encontré a esa persona." };

  const rec = new Date(p.recordedAt);
  const today = bogotaDay(now);
  const months = new Set<DayKey>([bogotaMonth(rec)]);
  for (const d of [lead?.closedAt, lead?.lostAt]) if (d) months.add(bogotaMonth(d));
  const offerIds = [...new Set([p.offerId, lead?.offerId, call.offerId].filter((x): x is string => Boolean(x)))];
  const undo: ConfirmUndo = {
    call: { outcome: call.outcome, confirmedAt: isoOf(call.confirmedAt), leadId: call.leadId, offerId: call.offerId },
    lead: lead
      ? {
          status: lead.status, closedAt: isoOf(lead.closedAt), lostAt: isoOf(lead.lostAt), lostReason: lead.lostReason,
          lastCallId: lead.lastCallId, lastCallAt: isoOf(lead.lastCallAt), lastContactAt: isoOf(lead.lastContactAt),
          nextContactAt: isoOf(lead.nextContactAt), nextMeetingAt: isoOf(lead.nextMeetingAt), needsMeetingDate: lead.needsMeetingDate, oneLine: lead.oneLine,
          whereLeft: lead.whereLeft, decider: lead.decider, offerId: lead.offerId,
          potentialCommission: lead.potentialCommission?.toString() ?? null, currency: lead.currency,
        }
      : null,
    prevOpenTaskId: openTask?.id ?? null,
    months: [...months],
    offerIds,
  };

  // 1. a new person, only while the change is still PENDING (an undone change never re-creates it)
  if (!lead && p.createLead) {
    const c = p.createLead;
    await db.$executeRaw`
      INSERT INTO "Lead" ("id", "userId", "name", "nameNorm", "email", "phone", "offerId", "status", "potentialCommission", "currency", "createdAt", "updatedAt")
      SELECT ${p.leadId}, ${userId}, ${c.name}, ${normalizeName(c.name)}, ${c.email}, ${c.phone}, ${p.offerId},
        'SEGUIMIENTO', ${p.potentialCommission}::numeric, ${p.currency}, now(), now()
      WHERE EXISTS (SELECT 1 FROM "ProposedChange" pc WHERE pc.id = ${changeId} AND pc."userId" = ${userId} AND pc.status = 'PENDING')
      ON CONFLICT ("id") DO NOTHING
    `;
  }
  // 2. claim: PENDING → APPLIED with the undo snapshot, in one statement
  const claimed = await db.$executeRaw`
    UPDATE "ProposedChange" SET "status" = 'APPLIED', "decidedAt" = now(), "undo" = ${JSON.stringify(undo)}::jsonb, "leadId" = ${p.leadId}
    WHERE "id" = ${changeId} AND "userId" = ${userId} AND "status" = 'PENDING'
  `;
  if (claimed === 0) return { ok: true, changeId, leadId: p.leadId, already: true };

  // 3. the person: status and «dónde quedaron» only from their latest call
  const status = STATUS_OF[p.outcome];
  const followAt = p.followDay ? ts(startOfDayInstant(p.followDay)) : null;
  const meetingAt = meetingInstant(p);
  const f = p.fields;
  await db.$executeRaw`
    UPDATE "Lead" l SET
      "offerId" = COALESCE(l."offerId", ${p.offerId}),
      "potentialCommission" = CASE WHEN l."offerId" IS NULL AND ${p.offerId}::text IS NOT NULL THEN ${p.potentialCommission}::numeric ELSE l."potentialCommission" END,
      "currency" = CASE WHEN l."offerId" IS NULL AND ${p.offerId}::text IS NOT NULL THEN ${p.currency} ELSE l."currency" END,
      "status" = CASE WHEN latest.ok THEN ${status}::"LeadStatus" ELSE l."status" END,
      "closedAt" = CASE WHEN latest.ok AND ${status} = 'CERRADO' THEN ${ts(rec)}::timestamp WHEN latest.ok THEN NULL ELSE l."closedAt" END,
      "lostAt" = CASE WHEN latest.ok AND ${status} = 'PERDIDO' THEN ${ts(rec)}::timestamp WHEN latest.ok THEN NULL ELSE l."lostAt" END,
      "lostReason" = CASE WHEN latest.ok AND ${status} = 'PERDIDO' THEN ${f.lostReason} WHEN latest.ok THEN NULL ELSE l."lostReason" END,
      "lastCallId" = CASE WHEN latest.ok THEN ${p.callId} ELSE l."lastCallId" END,
      "lastCallAt" = CASE WHEN latest.ok THEN ${ts(rec)}::timestamp ELSE l."lastCallAt" END,
      "lastContactAt" = GREATEST(l."lastContactAt", ${ts(rec)}::timestamp),
      "oneLine" = CASE WHEN latest.ok THEN COALESCE(${f.oneLine ? f.oneLine.slice(0, 140) : null}, l."oneLine") ELSE l."oneLine" END,
      "whereLeft" = CASE WHEN latest.ok THEN COALESCE(${f.whereLeft}, l."whereLeft") ELSE l."whereLeft" END,
      "decider" = COALESCE(${f.decider}, l."decider"),
      "nextContactAt" = CASE WHEN latest.ok AND ${p.outcome} IN ('SEGUIMIENTO', 'REAGENDAR') AND ${followAt}::timestamp IS NOT NULL THEN ${followAt}::timestamp ELSE l."nextContactAt" END,
      "nextMeetingAt" = CASE WHEN latest.ok AND ${p.outcome} = 'REAGENDAR' AND ${followAt}::timestamp IS NOT NULL THEN ${meetingAt ?? followAt}::timestamp ELSE l."nextMeetingAt" END,
      "needsMeetingDate" = CASE WHEN latest.ok THEN (${p.outcome} = 'REAGENDAR' AND ${followAt}::timestamp IS NULL) ELSE l."needsMeetingDate" END,
      "updatedAt" = now()
    FROM (SELECT (x."lastCallAt" IS NULL OR x."lastCallAt" <= ${ts(rec)}::timestamp) AS ok FROM "Lead" x WHERE x.id = ${p.leadId}) latest
    WHERE l.id = ${p.leadId} AND l."userId" = ${userId}
  `;
  // 4. the call
  await db.$executeRaw`
    UPDATE "Call" SET "state" = 'CONFIRMED', "outcome" = ${p.outcome}::"CallOutcome", "confirmedAt" = ${ts(now)}::timestamp,
      "leadId" = ${p.leadId}, "offerId" = COALESCE("offerId", ${p.offerId}), "updatedAt" = now()
    WHERE "id" = ${p.callId} AND "userId" = ${userId} AND "state" = 'PENDING_CONFIRM'
  `;
  // 5. history (append-only: «Deshacer» adds compensating UNDO events through proposedChangeId)
  const types = ["CALL", ...(status !== "SEGUIMIENTO" ? ["STATUS"] : []), ...(p.deal ? ["DEAL"] : [])];
  await db.$executeRaw`
    INSERT INTO "LeadEvent" ("id", "userId", "leadId", "at", "type", "callId", "proposedChangeId", "note")
    SELECT gen_random_uuid()::text, ${userId}, ${p.leadId}, ${ts(rec)}::timestamp, t::"LeadEventType", ${p.callId}, ${changeId},
      ${savedText(p.outcome, p.pendingPayment, p.outcome === "REAGENDAR" && !p.followDay).replace(/^Guardado: /, "").slice(0, 300)}
    FROM unnest(${types}::text[]) AS t
    WHERE NOT EXISTS (
      SELECT 1 FROM "LeadEvent" e WHERE e."leadId" = ${p.leadId} AND e."proposedChangeId" = ${changeId} AND e.type = t::"LeadEventType"
    )
  `;
  // 6. the sale, with its commission frozen now
  if (p.deal) {
    const d = p.deal;
    await db.$executeRaw`
      INSERT INTO "Deal" ("id", "userId", "leadId", "offerId", "callId", "proposedChangeId", "closedAt", "amountTotal",
        "paymentMode", "cashCollected", "commissionAmount", "currency", "status", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${userId}, ${p.leadId}, ${p.offerId}, ${p.callId}, ${changeId}, ${ts(rec)}::timestamp,
        ${d.amountTotal}::numeric, ${d.paymentMode}::"PaymentMode", ${d.cashCollected}::numeric, ${d.commissionAmount}::numeric,
        ${d.currency}, 'ACTIVO', now(), now())
      ON CONFLICT ("userId", "proposedChangeId") DO NOTHING
    `;
  }
  // 7. «Pendiente de pago» → COBRAR; «Reagendar» with a date → REUNION on that day (and time).
  //    One OPEN task per lead, so the new task replaces the open one.
  if (taskKind) {
    if (openTask) {
      await db.$executeRaw`
        UPDATE "FollowUpTask" SET "status" = 'CANCELED'
        WHERE "id" = ${openTask.id} AND "userId" = ${userId} AND "status" = 'OPEN'
      `;
    }
    await db.$executeRaw`
      INSERT INTO "FollowUpTask" ("id", "userId", "leadId", "dueDate", "dueAt", "kind", "note", "origin", "status", "createdAt", "proposedChangeId")
      VALUES (gen_random_uuid()::text, ${userId}, ${p.leadId}, ${p.followDay ?? today}::date, ${meetingAt}::timestamp, ${taskKind}::"TaskKind",
        ${taskKind === "COBRAR" ? PENDING_PAYMENT_LABEL : null}, 'CONFIRM', 'OPEN', now(), ${changeId})
      ON CONFLICT ("leadId") WHERE "status" = 'OPEN' DO NOTHING
    `;
  }
  // 8. the brief's suggestions for this call are decided by this tap
  if (p.briefApplied.length || p.briefRejected.length) {
    await db.$executeRaw`
      UPDATE "ProposedChange" SET "decidedAt" = now(),
        "status" = CASE WHEN "id" = ANY(${p.briefApplied}::text[]) THEN 'APPLIED'::"ChangeStatus" ELSE 'REJECTED'::"ChangeStatus" END
      WHERE "userId" = ${userId} AND "id" = ANY(${[...p.briefApplied, ...p.briefRejected]}::text[]) AND "status" = 'PENDING'
    `;
  }
  await recountAll(db, userId, today, undo, p.leadId);
  invalidate(userId, WRITE_EFFECTS.applyProposedChange(p.leadId), opts.revalidate);
  return { ok: true, changeId, leadId: p.leadId };
}

/** The task a confirmation creates: COBRAR for «pendiente de pago», REUNION for «Reagendar» with a date. */
export function changeTask(p: Pick<ConfirmPayload, "pendingPayment" | "outcome" | "followDay">): "COBRAR" | "REUNION" | null {
  if (p.pendingPayment) return "COBRAR";
  if (p.outcome === "REAGENDAR" && p.followDay) return "REUNION";
  return null;
}

/** The meeting as an instant when the brief gave a day AND a time (Bogotá), else null. */
function meetingInstant(p: Pick<ConfirmPayload, "outcome" | "followDay" | "followTime">): string | null {
  if (p.outcome !== "REAGENDAR" || !p.followDay || !p.followTime) return null;
  const [h, m] = p.followTime.split(":").map(Number);
  return ts(new Date(startOfDayInstant(p.followDay).getTime() + (h * 60 + m) * 60000));
}

async function recountAll(db: Db, userId: string, today: DayKey, undo: ConfirmUndo, leadId: string) {
  const offers = undo.offerIds.length ? undo.offerIds : [null];
  for (const offerId of offers) {
    await recount(db, userId, { today, months: undo.months, offerId, leadId: offerId === offers[0] ? leadId : null });
  }
}

/**
 * «Deshacer»: puts back exactly what the change found. The sale is annulled
 * (ANULADO, out of every sum), the task it created is canceled, its history
 * events get compensating UNDO events (never deleted), the call goes back to
 * «por confirmar» and every number is recounted. A person the change created
 * is removed (with its rows) unless another call was confirmed to them since.
 */
export async function undoProposedChange(db: Db, userId: string, changeId: string, opts: WriteOpts = {}): Promise<ConfirmResult> {
  const now = opts.now ?? new Date();
  const change = await db.proposedChange.findFirst({
    where: { id: changeId, userId },
    select: { kind: true, status: true, payload: true, undo: true },
  });
  if (!change || change.kind !== "CONFIRM_CALL") return { ok: false, error: "No encontré ese cambio." };
  const p = change.payload as unknown as ConfirmPayload;
  if (change.status !== "APPLIED" || !change.undo) return { ok: true, changeId, leadId: p.leadId, already: true };
  const u = change.undo as unknown as ConfirmUndo;
  const claimed = await db.$executeRaw`
    UPDATE "ProposedChange" SET "status" = 'UNDONE', "decidedAt" = now()
    WHERE "id" = ${changeId} AND "userId" = ${userId} AND "status" = 'APPLIED'
  `;
  if (claimed === 0) return { ok: true, changeId, leadId: p.leadId, already: true };

  await db.$executeRaw`
    UPDATE "Deal" SET "status" = 'ANULADO', "updatedAt" = now()
    WHERE "userId" = ${userId} AND "proposedChangeId" = ${changeId} AND "status" = 'ACTIVO'
  `;
  await db.$executeRaw`
    UPDATE "FollowUpTask" SET "status" = 'CANCELED'
    WHERE "leadId" = ${p.leadId} AND "proposedChangeId" = ${changeId} AND "userId" = ${userId} AND "status" = 'OPEN'
  `;
  if (u.prevOpenTaskId) {
    await db.$executeRaw`
      UPDATE "FollowUpTask" t SET "status" = 'OPEN'
      WHERE t."id" = ${u.prevOpenTaskId} AND t."userId" = ${userId} AND t."status" = 'CANCELED'
        AND NOT EXISTS (SELECT 1 FROM "FollowUpTask" o WHERE o."leadId" = t."leadId" AND o."status" = 'OPEN')
    `;
  }
  await compensateEvents(db, userId, { leadId: p.leadId, proposedChangeId: changeId }, now);
  await db.$executeRaw`
    UPDATE "Call" SET "state" = 'PENDING_CONFIRM', "outcome" = ${u.call.outcome}::"CallOutcome",
      "confirmedAt" = ${tsIso(u.call.confirmedAt)}::timestamp, "leadId" = ${u.call.leadId}, "offerId" = ${u.call.offerId}, "updatedAt" = now()
    WHERE "id" = ${p.callId} AND "userId" = ${userId} AND "state" = 'CONFIRMED'
  `;
  const l = u.lead;
  if (!l) {
    // created by this change: removed unless another call was confirmed to them since
    await db.$executeRaw`
      DELETE FROM "Lead" x
      WHERE x."id" = ${p.leadId} AND x."userId" = ${userId}
        AND NOT EXISTS (SELECT 1 FROM "Call" c WHERE c."leadId" = x."id" AND c."id" <> ${p.callId})
    `;
  } else {
    await db.$executeRaw`
      UPDATE "Lead" SET "status" = ${l.status}::"LeadStatus", "closedAt" = ${tsIso(l.closedAt)}::timestamp,
        "lostAt" = ${tsIso(l.lostAt)}::timestamp, "lostReason" = ${l.lostReason}, "lastCallId" = ${l.lastCallId},
        "lastCallAt" = ${tsIso(l.lastCallAt)}::timestamp, "lastContactAt" = ${tsIso(l.lastContactAt)}::timestamp,
        "nextContactAt" = ${tsIso(l.nextContactAt)}::timestamp, "nextMeetingAt" = ${tsIso(l.nextMeetingAt)}::timestamp,
        "needsMeetingDate" = ${l.needsMeetingDate ?? false}, "oneLine" = ${l.oneLine}, "whereLeft" = ${l.whereLeft}, "decider" = ${l.decider}, "offerId" = ${l.offerId},
        "potentialCommission" = ${l.potentialCommission}::numeric, "currency" = ${l.currency}, "updatedAt" = now()
      WHERE "id" = ${p.leadId} AND "userId" = ${userId}
    `;
  }
  if (p.briefApplied.length || p.briefRejected.length) {
    await db.$executeRaw`
      UPDATE "ProposedChange" SET "status" = 'PENDING', "decidedAt" = NULL
      WHERE "userId" = ${userId} AND "id" = ANY(${[...p.briefApplied, ...p.briefRejected]}::text[]) AND "status" IN ('APPLIED', 'REJECTED')
    `;
  }
  const leadLeft = l ? p.leadId : null;
  const today = bogotaDay(now);
  const offers = u.offerIds.length ? u.offerIds : [null];
  for (const offerId of offers) {
    await recount(db, userId, { today, months: u.months, offerId, leadId: offerId === offers[0] ? leadLeft : null });
  }
  invalidate(userId, WRITE_EFFECTS.undoProposedChange(p.leadId), opts.revalidate);
  return { ok: true, changeId, leadId: leadLeft };
}
