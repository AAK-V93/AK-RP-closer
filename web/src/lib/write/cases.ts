// Success cases (revision-arquitecto-casos-exito.md). A sync rewrites only
// *Extracted + sourceSnippet; review writes only *User / confirmedAt /
// dismissed. Single statements (Neon HTTP); ownership in each WHERE.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { type ModelCall, extractCases } from "@/lib/cases/extract";
import type { CaseFields } from "@/lib/cases/items";
import { parseCaseLink, parseCaseLinks } from "@/lib/cases/links";
import { type LoadDeps, loadSource } from "@/lib/cases/load";
import { type ExistingCase, planSync } from "@/lib/cases/merge";
import { userValue } from "@/lib/cases/view";
import { WRITE_EFFECTS } from "@/lib/read/tags";
import { invalidate } from "./invalidate";
import type { WriteOpts, WriteResult } from "./offers";

type Db = PrismaClient;

export const SOURCES_MAX = 10;
export const CASES_MAX = 500;

async function ownsOffer(db: Db, userId: string, offerId: string) {
  return Boolean(await db.offer.findFirst({ where: { id: offerId, userId }, select: { id: true } }));
}

export async function addCaseSources(
  db: Db,
  userId: string,
  offerId: string,
  text: string,
  opts: WriteOpts = {},
): Promise<WriteResult<{ added: string[]; invalid: Array<{ rawUrl: string; reason: string }> }>> {
  if (!(await ownsOffer(db, userId, offerId))) return { ok: false, error: "No encontré esa oferta" };
  const parsed = parseCaseLinks(text);
  if (!parsed.length) return { ok: false, error: "Pega al menos un enlace" };
  const existing = await db.offerCaseSource.findMany({
    where: { userId, offerId },
    take: SOURCES_MAX,
    select: { id: true, externalId: true },
  });
  const known = new Map(existing.map((s) => [s.externalId, s.id]));
  const added: string[] = [];
  const invalid: Array<{ rawUrl: string; reason: string }> = [];
  for (const link of parsed) {
    if (!link.ok) {
      invalid.push({ rawUrl: link.rawUrl, reason: link.reason });
      continue;
    }
    const already = known.get(link.externalId);
    if (already) {
      added.push(already); // read it again
      continue;
    }
    if (known.size >= SOURCES_MAX) {
      invalid.push({ rawUrl: link.rawUrl, reason: `Cada oferta puede tener hasta ${SOURCES_MAX} enlaces` });
      continue;
    }
    const row = await db.offerCaseSource
      .create({ data: { userId, offerId, rawUrl: link.rawUrl, kind: link.kind, externalId: link.externalId }, select: { id: true } })
      .catch(() => null);
    if (row) {
      known.set(link.externalId, row.id);
      added.push(row.id);
    }
  }
  invalidate(userId, WRITE_EFFECTS.addCaseSources(), opts.revalidate);
  return { ok: true, added, invalid };
}

/** A sheet picked in Google Drive (drive.file): read with the person's Drive token. */
export async function addDriveSheet(
  db: Db,
  userId: string,
  offerId: string,
  file: { id: string; name: string | null; url: string | null },
  opts: WriteOpts = {},
): Promise<WriteResult<{ id: string }>> {
  if (!(await ownsOffer(db, userId, offerId))) return { ok: false, error: "No encontré esa oferta" };
  if (!/^[\w-]{20,}$/.test(file.id)) return { ok: false, error: "Esa no parece una hoja de cálculo" };
  const rawUrl = file.url ?? `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
  const parsed = parseCaseLink(rawUrl);
  const externalId = parsed.ok && parsed.kind === "SHEET" ? parsed.externalId : file.id;
  const found = await db.offerCaseSource.findFirst({ where: { userId, offerId, externalId }, select: { id: true } });
  const id = found
    ? (
        await db.offerCaseSource.update({
          where: { id: found.id, userId },
          data: { access: "DRIVE_PICKER", status: "PENDING", lastError: null, contentHash: null, title: file.name },
          select: { id: true },
        })
      ).id
    : (
        await db.offerCaseSource.create({
          data: { userId, offerId, rawUrl, kind: "SHEET", access: "DRIVE_PICKER", externalId, title: file.name },
          select: { id: true },
        })
      ).id;
  invalidate(userId, WRITE_EFFECTS.addDriveSheet(), opts.revalidate);
  return { ok: true, id };
}

export type SyncDeps = LoadDeps & { model?: ModelCall | null };

export type SyncResult = {
  status: "READY" | "NEEDS_ACCESS" | "ERROR";
  message: string | null;
  found: number;
  added: number;
  changed: number;
  missing: number;
  modelCalls: number;
};

function extractedData(f: CaseFields) {
  return {
    nameExtracted: f.name ?? "",
    profileExtracted: f.profile,
    beforeExtracted: f.before,
    resultExtracted: f.result,
    quoteExtracted: f.quote,
    mediaUrlExtracted: f.mediaUrl,
  };
}

/**
 * Reads a source again. Same contentHash → no model call, nothing rewritten.
 * Changed → only new/changed rows get *Extracted + snippet; *User,
 * dismissed and confirmedAt are kept; rows gone from the source are marked.
 */
export async function syncCaseSource(
  db: Db,
  userId: string,
  sourceId: string,
  deps: SyncDeps = {},
  opts: WriteOpts = {},
): Promise<WriteResult<{ result: SyncResult }>> {
  const now = opts.now ?? new Date();
  const source = await db.offerCaseSource.findFirst({
    where: { id: sourceId, userId },
    select: { id: true, offerId: true, kind: true, access: true, externalId: true, contentHash: true, status: true },
  });
  if (!source) return { ok: false, error: "No encontré ese enlace" };
  const result: SyncResult = { status: "READY", message: null, found: 0, added: 0, changed: 0, missing: 0, modelCalls: 0 };

  const loaded = await loadSource(
    { ...source, contentHash: source.status === "READY" ? source.contentHash : null },
    deps,
  );
  if (loaded.status === "NEEDS_ACCESS" || loaded.status === "ERROR") {
    await db.offerCaseSource.update({
      where: { id: source.id, userId },
      data: { status: loaded.status, lastError: loaded.message, lastSyncedAt: now },
      select: { id: true },
    });
    invalidate(userId, WRITE_EFFECTS.syncCaseSource(), opts.revalidate);
    return { ok: true, result: { ...result, status: loaded.status, message: loaded.message } };
  }
  if (loaded.status === "UNCHANGED") {
    await db.offerCaseSource.update({
      where: { id: source.id, userId },
      data: { status: "READY", lastError: null, lastSyncedAt: now },
      select: { id: true },
    });
    invalidate(userId, WRITE_EFFECTS.syncCaseSource(), opts.revalidate);
    return { ok: true, result };
  }

  const { cases, modelCalls } = await extractCases(loaded.items, { model: deps.model, titles: loaded.titles });
  result.modelCalls = modelCalls;
  result.found = cases.length;
  const rows = await db.successCase.findMany({
    where: { userId, offerId: source.offerId },
    take: CASES_MAX,
    select: {
      id: true, externalKey: true, sourceId: true, sourceSnippet: true, missingFromSourceAt: true,
      nameExtracted: true, profileExtracted: true, beforeExtracted: true, resultExtracted: true,
      quoteExtracted: true, mediaUrlExtracted: true,
    },
  });
  const existing: ExistingCase[] = rows.map((r) => ({
    id: r.id,
    externalKey: r.externalKey,
    sourceId: r.sourceId,
    sourceSnippet: r.sourceSnippet,
    missingFromSourceAt: r.missingFromSourceAt,
    extracted: {
      name: r.nameExtracted || null,
      profile: r.profileExtracted,
      before: r.beforeExtracted,
      result: r.resultExtracted,
      quote: r.quoteExtracted,
      mediaUrl: r.mediaUrlExtracted,
    },
  }));
  const plan = planSync(source.id, existing, cases);
  const room = Math.max(0, CASES_MAX - rows.length);
  for (const c of plan.inserts.slice(0, room)) {
    const created = await db.successCase
      .create({
        data: { userId, offerId: source.offerId, sourceId: source.id, externalKey: c.externalKey, sourceSnippet: c.snippet, ...extractedData(c.fields) },
        select: { id: true },
      })
      .catch(() => null); // same key written meanwhile: the next sync updates it
    if (created) result.added += 1;
  }
  const updated = new Set<string>();
  for (const u of plan.updates) {
    await db.successCase.update({
      where: { id: u.id, userId },
      data: { sourceSnippet: u.snippet, ...extractedData(u.fields), missingFromSourceAt: null },
      select: { id: true },
    });
    updated.add(u.id);
    result.changed += 1;
  }
  for (const id of plan.back.filter((b) => !updated.has(b))) {
    await db.successCase.update({ where: { id, userId }, data: { missingFromSourceAt: null }, select: { id: true } });
  }
  for (const id of plan.missing) {
    await db.successCase.update({ where: { id, userId }, data: { missingFromSourceAt: now }, select: { id: true } });
    result.missing += 1;
  }
  await db.offerCaseSource.update({
    where: { id: source.id, userId },
    data: { status: "READY", lastError: null, lastSyncedAt: now, contentHash: loaded.hash, ...(loaded.title ? { title: loaded.title } : {}) },
    select: { id: true },
  });
  invalidate(userId, WRITE_EFFECTS.syncCaseSource(), opts.revalidate);
  return { ok: true, result };
}

export type ReviewItem = {
  id: string;
  name?: string | null;
  profile?: string | null;
  before?: string | null;
  result?: string | null;
  quote?: string | null;
  mediaUrl?: string | null;
  decision: "confirm" | "dismiss" | "keep";
};

export const REVIEW_MAX = 60;

/** «Guardar» on «Encontré N casos, así los entendí»: only *User, confirmedAt and dismissed. */
export async function saveCaseReview(
  db: Db,
  userId: string,
  offerId: string,
  items: ReviewItem[],
  opts: WriteOpts = {},
): Promise<WriteResult<{ confirmed: number; dismissed: number }>> {
  const list = items.slice(0, REVIEW_MAX);
  if (!list.length) return { ok: true, confirmed: 0, dismissed: 0 };
  const rows = await db.successCase.findMany({
    where: { userId, offerId, id: { in: list.map((i) => i.id) } },
    take: REVIEW_MAX,
    select: {
      id: true, confirmedAt: true, nameExtracted: true, profileExtracted: true, beforeExtracted: true,
      resultExtracted: true, quoteExtracted: true, mediaUrlExtracted: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const now = opts.now ?? new Date();
  let confirmed = 0;
  let dismissed = 0;
  for (const item of list) {
    const row = byId.get(item.id);
    if (!row) continue;
    if (item.decision === "dismiss") {
      await db.successCase.update({ where: { id: row.id, userId }, data: { dismissed: true }, select: { id: true } });
      dismissed += 1;
      continue;
    }
    const field = (typed: string | null | undefined, extracted: string | null) =>
      typed === undefined ? undefined : userValue(typed, extracted);
    const data = {
      nameUser: field(item.name, row.nameExtracted || null),
      profileUser: field(item.profile, row.profileExtracted),
      beforeUser: field(item.before, row.beforeExtracted),
      resultUser: field(item.result, row.resultExtracted),
      quoteUser: field(item.quote, row.quoteExtracted),
      mediaUrlUser: field(item.mediaUrl, row.mediaUrlExtracted),
      ...(item.decision === "confirm" ? { confirmedAt: row.confirmedAt ?? now, dismissed: false } : {}),
    };
    await db.successCase.update({ where: { id: row.id, userId }, data, select: { id: true } });
    if (item.decision === "confirm") confirmed += 1;
  }
  invalidate(userId, WRITE_EFFECTS.saveCaseReview(), opts.revalidate);
  return { ok: true, confirmed, dismissed };
}

/** A case typed by hand: it is the person's own words, so it is confirmed at once. */
export async function addManualCase(
  db: Db,
  userId: string,
  offerId: string,
  fields: Omit<CaseFields, "name"> & { name: string },
  opts: WriteOpts = {},
): Promise<WriteResult<{ id: string }>> {
  const name = fields.name.trim();
  if (!name) return { ok: false, error: "Escribe quién es" };
  if (!(await ownsOffer(db, userId, offerId))) return { ok: false, error: "No encontré esa oferta" };
  const t = (v: string | null) => (v?.trim() ? v.trim().slice(0, 2000) : null);
  const row = await db.successCase.create({
    data: {
      userId,
      offerId,
      externalKey: `manual:${randomUUID()}`,
      nameUser: name.slice(0, 200),
      profileUser: t(fields.profile),
      beforeUser: t(fields.before),
      resultUser: t(fields.result),
      quoteUser: t(fields.quote),
      mediaUrlUser: t(fields.mediaUrl),
      confirmedAt: opts.now ?? new Date(),
    },
    select: { id: true },
  });
  invalidate(userId, WRITE_EFFECTS.addManualCase(), opts.revalidate);
  return { ok: true, id: row.id };
}
