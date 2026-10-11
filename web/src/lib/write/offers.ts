// Mis ofertas writes (plan 3.2 PR 3). Single statements only (Neon HTTP):
// ownership goes in the WHERE of the same update; no transactions.
import type { CommissionType, PrismaClient, ScriptOrigin } from "@prisma/client";
import { perCloseCommission } from "@/lib/metrics";
import { WRITE_EFFECTS } from "@/lib/read/tags";
import { bogotaDay } from "@/lib/time/bogota";
import { invalidate } from "./invalidate";
import { recountCounters } from "./recount";

type Db = PrismaClient;
export type WriteOpts = { revalidate?: (tag: string) => void; now?: Date };
export type WriteResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type OfferInput = {
  id?: string | null;
  name: string;
  description?: string;
  currency: string;
  priceCash?: string | null;
  installmentsCount?: number | null;
  installmentAmount?: string | null;
  commissionType?: CommissionType | null;
  commissionValue?: string | null;
};

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

/** «10.000», «10,000», «1.500,50» or «1500.5» → «10000» / «1500.50»; null when empty; Error when not a number. */
export function parseAmount(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/[\s$]|USD|COP|EUR|MXN/gi, "");
  if (!t) return null;
  let n = t;
  const lastSep = Math.max(n.lastIndexOf("."), n.lastIndexOf(","));
  if (lastSep >= 0 && n.length - lastSep - 1 <= 2 && n.length - lastSep - 1 > 0) {
    n = `${n.slice(0, lastSep).replace(/[.,]/g, "")}.${n.slice(lastSep + 1)}`;
  } else {
    n = n.replace(/[.,]/g, "");
  }
  if (!MONEY.test(n)) throw new Error("amount");
  return n;
}

export function validateOffer(input: OfferInput): WriteResult<{ data: Omit<OfferInput, "id"> }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Ponle un nombre a la oferta" };
  if (name.length > 120) return { ok: false, error: "El nombre es muy largo" };
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "Elige la moneda" };
  let priceCash: string | null;
  let installmentAmount: string | null;
  let commissionValue: string | null;
  try {
    priceCash = parseAmount(input.priceCash);
    installmentAmount = parseAmount(input.installmentAmount);
    commissionValue = parseAmount(input.commissionValue);
  } catch {
    return { ok: false, error: "Revisa los montos: solo números" };
  }
  const count = input.installmentsCount ?? null;
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 60)) {
    return { ok: false, error: "El número de cuotas va de 1 a 60" };
  }
  const type = input.commissionType ?? null;
  if (type && type !== "PER_CLOSE" && commissionValue !== null && Number(commissionValue) > 100) {
    return { ok: false, error: "El porcentaje va de 0 a 100" };
  }
  return {
    ok: true,
    data: {
      name,
      description: (input.description ?? "").trim().slice(0, 20_000),
      currency,
      priceCash,
      installmentsCount: count,
      installmentAmount,
      commissionType: type,
      commissionValue: type ? commissionValue : null,
    },
  };
}

/**
 * Lead.potentialCommission of this offer's people still in SEGUIMIENTO =
 * commission per close (null = por confirmar). ONE statement; closed and lost
 * leads keep what they had (Arquitectura, PR 3 review, item 3).
 */
async function refreshPotentialCommission(db: Db, userId: string, offerId: string, data: Omit<OfferInput, "id">) {
  const perClose = perCloseCommission({
    commissionType: data.commissionType ?? null,
    commissionValue: data.commissionValue ?? null,
    priceCash: data.priceCash ?? null,
  });
  const value = perClose.cents === null ? null : (perClose.cents / 100).toFixed(2);
  await db.$executeRaw`
    UPDATE "Lead" SET "potentialCommission" = ${value}::numeric, "currency" = ${data.currency}, "updatedAt" = now()
    WHERE "offerId" = ${offerId} AND "userId" = ${userId} AND "status" = 'SEGUIMIENTO'
  `;
}

export async function upsertOffer(db: Db, userId: string, input: OfferInput, opts: WriteOpts = {}): Promise<WriteResult<{ id: string }>> {
  const v = validateOffer(input);
  if (!v.ok) return v;
  let id: string;
  if (input.id) {
    const updated = await db.offer
      .update({ where: { id: input.id, userId, archivedAt: null }, data: v.data, select: { id: true } })
      .catch(() => null);
    if (!updated) return { ok: false, error: "No encontré esa oferta" };
    id = updated.id;
  } else {
    id = (await db.offer.create({ data: { ...v.data, userId }, select: { id: true } })).id;
  }
  await refreshPotentialCommission(db, userId, id, v.data);
  await recountCounters(db, userId, bogotaDay(opts.now ?? new Date()));
  invalidate(userId, WRITE_EFFECTS.upsertOffer(), opts.revalidate);
  return { ok: true, id };
}

export async function archiveOffer(db: Db, userId: string, offerId: string, opts: WriteOpts = {}): Promise<WriteResult> {
  const done = await db.offer
    .update({ where: { id: offerId, userId }, data: { archivedAt: opts.now ?? new Date() }, select: { id: true } })
    .catch(() => null);
  if (!done) return { ok: false, error: "No encontré esa oferta" };
  invalidate(userId, WRITE_EFFECTS.archiveOffer(), opts.revalidate);
  return { ok: true };
}

export type ScriptInput = { id?: string | null; offerId: string | null; title: string; body: string; origin?: ScriptOrigin };

export async function upsertScript(db: Db, userId: string, input: ScriptInput, opts: WriteOpts = {}): Promise<WriteResult<{ id: string }>> {
  const title = input.title.trim().slice(0, 140);
  const body = input.body.trim().slice(0, 10_000);
  if (!title) return { ok: false, error: "Ponle un título al guion" };
  if (!body) return { ok: false, error: "Escribe el guion" };
  if (input.offerId) {
    const offer = await db.offer.findFirst({ where: { id: input.offerId, userId }, select: { id: true } });
    if (!offer) return { ok: false, error: "No encontré esa oferta" };
  }
  const data = { title, body, offerId: input.offerId, ...(input.origin ? { origin: input.origin } : {}) };
  let id: string;
  if (input.id) {
    const updated = await db.script.update({ where: { id: input.id, userId }, data, select: { id: true } }).catch(() => null);
    if (!updated) return { ok: false, error: "No encontré ese guion" };
    id = updated.id;
  } else {
    id = (await db.script.create({ data: { ...data, origin: input.origin ?? "PROPIO", userId }, select: { id: true } })).id;
  }
  invalidate(userId, WRITE_EFFECTS.upsertScript(), opts.revalidate);
  return { ok: true, id };
}

export async function deleteScript(db: Db, userId: string, scriptId: string, opts: WriteOpts = {}): Promise<WriteResult> {
  const done = await db.script.delete({ where: { id: scriptId, userId }, select: { id: true } }).catch(() => null);
  if (!done) return { ok: false, error: "No encontré ese guion" };
  invalidate(userId, WRITE_EFFECTS.deleteScript(), opts.revalidate);
  return { ok: true };
}
