// Mis ofertas (plan 2.1): ≤20 offers with counts in one query; scripts and
// cases only for the open tab (take 8 + «Ver más»).
import { type Db, amount, iso } from "./dto";

export const OFFERS_TAKE = 20;
export const TAB_TAKE = 8;
export const TAB_TAKE_ALL = 50;
export const REVIEW_TAKE = 60;
export const SOURCES_TAKE = 10;

/** Offer map for names and commission (cached apart, tag offers): no join per row. */
export async function readOfferMap(db: Db, userId: string) {
  const rows = await db.offer.findMany({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    take: OFFERS_TAKE,
    select: { id: true, name: true, currency: true, priceCash: true, commissionType: true, commissionValue: true },
  });
  return rows.map((o) => ({ ...o, priceCash: amount(o.priceCash), commissionValue: amount(o.commissionValue) }));
}

const SUGGESTIBLE = { confirmedAt: { not: null }, dismissed: false, missingFromSourceAt: null };
const TO_REVIEW = { confirmedAt: null, dismissed: false, missingFromSourceAt: null };

export async function readOffersPage(db: Db, userId: string) {
  const [offers, review, fathom, drive, calls] = await Promise.all([
    db.offer.findMany({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: "asc" },
      take: OFFERS_TAKE,
      select: {
        id: true,
        name: true,
        description: true,
        currency: true,
        priceCash: true,
        installmentsCount: true,
        installmentAmount: true,
        commissionType: true,
        commissionValue: true,
        _count: { select: { scripts: true, successCases: { where: SUGGESTIBLE }, caseSources: true } },
      },
    }),
    db.successCase.groupBy({
      by: ["offerId"],
      where: { userId, ...TO_REVIEW },
      _count: { _all: true },
      orderBy: { offerId: "asc" },
      take: OFFERS_TAKE,
    }),
    db.fathomConnection.findUnique({ where: { userId }, select: { lastSyncAt: true, backfillStatus: true, backfillImported: true } }),
    db.googleDriveConnection.findUnique({ where: { userId }, select: { id: true } }),
    // «Tus llamadas»: calls still being summarized or whose summary failed (no transcript, no brief)
    db.call.groupBy({
      by: ["state"],
      where: { userId, state: { in: ["PROCESSING", "BRIEF_FAILED"] } },
      _count: { _all: true },
      orderBy: { state: "asc" },
      take: 2,
    }),
  ]);
  const byState = new Map(calls.map((c) => [c.state, c._count._all]));
  const toReview = new Map(review.map((r) => [r.offerId, r._count._all]));
  return {
    offers: offers.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      currency: o.currency,
      priceCash: amount(o.priceCash),
      installmentsCount: o.installmentsCount,
      installmentAmount: amount(o.installmentAmount),
      commissionType: o.commissionType,
      commissionValue: amount(o.commissionValue),
      scripts: o._count.scripts,
      cases: o._count.successCases,
      sources: o._count.caseSources,
      casesToReview: toReview.get(o.id) ?? 0,
    })),
    fathom: fathom
      ? { connected: true, lastSyncAt: iso(fathom.lastSyncAt), backfill: fathom.backfillStatus, imported: fathom.backfillImported }
      : { connected: false, lastSyncAt: null, backfill: "NONE" as const, imported: 0 },
    calls: { processing: byState.get("PROCESSING") ?? 0, failed: byState.get("BRIEF_FAILED") ?? 0 },
    driveConnected: Boolean(drive),
  };
}

export type OffersPage = Awaited<ReturnType<typeof readOffersPage>>;
export type OfferCard = OffersPage["offers"][number];

/** Guiones tab: this offer's scripts (and the ones without an offer), best results first. */
export async function readOfferScripts(db: Db, userId: string, offerId: string, all: boolean) {
  const rows = await db.script.findMany({
    where: { userId, OR: [{ offerId }, { offerId: null }] },
    orderBy: [{ paidCount: "desc" }, { repliesCount: "desc" }, { usesCount: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    take: all ? TAB_TAKE_ALL : TAB_TAKE + 1,
    select: {
      id: true,
      offerId: true,
      title: true,
      body: true,
      origin: true,
      usesCount: true,
      repliesCount: true,
      paidCount: true,
    },
  });
  const limit = all ? TAB_TAKE_ALL : TAB_TAKE;
  return { scripts: rows.slice(0, limit), hasMore: !all && rows.length > TAB_TAKE };
}

const CASE_SELECT = {
  id: true,
  externalKey: true,
  sourceId: true,
  nameExtracted: true,
  profileExtracted: true,
  beforeExtracted: true,
  resultExtracted: true,
  quoteExtracted: true,
  mediaUrlExtracted: true,
  sourceSnippet: true,
  nameUser: true,
  profileUser: true,
  beforeUser: true,
  resultUser: true,
  quoteUser: true,
  mediaUrlUser: true,
  confirmedAt: true,
  dismissed: true,
  missingFromSourceAt: true,
} as const;

type CaseRecord = {
  confirmedAt: Date | null;
  missingFromSourceAt: Date | null;
} & Record<string, unknown>;

function caseDto<T extends CaseRecord>(c: T) {
  return { ...c, confirmedAt: iso(c.confirmedAt), missingFromSourceAt: iso(c.missingFromSourceAt) };
}

/** Casos de éxito tab: confirmed cases, the ones waiting for review, and the links. */
export async function readOfferCases(db: Db, userId: string, offerId: string, all = false) {
  const [confirmed, toReview, missing, sources] = await Promise.all([
    db.successCase.findMany({
      where: { userId, offerId, ...SUGGESTIBLE },
      orderBy: [{ confirmedAt: "desc" }, { id: "asc" }],
      take: all ? TAB_TAKE_ALL : TAB_TAKE + 1,
      select: CASE_SELECT,
    }),
    db.successCase.findMany({
      where: { userId, offerId, ...TO_REVIEW },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: REVIEW_TAKE,
      select: CASE_SELECT,
    }),
    db.successCase.findMany({
      where: { userId, offerId, dismissed: false, missingFromSourceAt: { not: null } },
      orderBy: [{ missingFromSourceAt: "desc" }, { id: "asc" }],
      take: TAB_TAKE,
      select: CASE_SELECT,
    }),
    db.offerCaseSource.findMany({
      where: { userId, offerId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: SOURCES_TAKE,
      select: {
        id: true,
        rawUrl: true,
        kind: true,
        access: true,
        title: true,
        status: true,
        lastSyncedAt: true,
        lastError: true,
      },
    }),
  ]);
  const limit = all ? TAB_TAKE_ALL : TAB_TAKE;
  return {
    confirmed: confirmed.slice(0, limit).map(caseDto),
    hasMore: !all && confirmed.length > TAB_TAKE,
    toReview: toReview.map(caseDto),
    missing: missing.map(caseDto),
    sources: sources.map((s) => ({ ...s, lastSyncedAt: iso(s.lastSyncedAt) })),
  };
}

export type OfferCases = Awaited<ReturnType<typeof readOfferCases>>;
export type OfferCaseDto = OfferCases["confirmed"][number];
