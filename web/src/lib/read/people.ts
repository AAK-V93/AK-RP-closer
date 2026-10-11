// Personas (plan 2.1): keyset pagination on (lastContactAt desc, id desc),
// 8 rows then 10, never skip/offset. Tab counts come from UserCounters and
// UserMonthStats, never count().
import { type FollowUpStage, followUpStageRange } from "@/lib/metrics";
import { type DayKey, BOGOTA, monthRange } from "@/lib/time/bogota";
import { normalizeName } from "@/lib/text/name-norm";
import type { Prisma } from "@prisma/client";
import { type Db } from "./dto";
import { PERSON_ROW_SELECT, type PersonRow, personRow } from "./today";

export const PEOPLE_FIRST_PAGE = 8;
export const PEOPLE_NEXT_PAGE = 10;
export const SEARCH_TAKE = 10;

export type PeopleCursor = { lastContactAt: string | null; id: string };
export type PeopleQuery = {
  tab: "SEGUIMIENTO" | "CERRADO" | "PERDIDO";
  offerId?: string | null;
  stage?: FollowUpStage | null;
  /** YYYY-MM-01 for Cerrados/Perdidos; null = «todo». En seguimiento has no period. */
  month?: DayKey | null;
  cursor?: PeopleCursor | null;
  timeZone?: string;
};

function afterCursor(c: PeopleCursor): Prisma.LeadWhereInput {
  // Order: lastContactAt desc with nulls last, then id desc.
  if (c.lastContactAt === null) return { lastContactAt: null, id: { lt: c.id } };
  const at = new Date(c.lastContactAt);
  return {
    OR: [
      { lastContactAt: { lt: at } },
      { lastContactAt: at, id: { lt: c.id } },
      { lastContactAt: null },
    ],
  };
}

export async function readPeoplePage(db: Db, userId: string, q: PeopleQuery) {
  const take = q.cursor ? PEOPLE_NEXT_PAGE : PEOPLE_FIRST_PAGE;
  const where: Prisma.LeadWhereInput = { userId, status: q.tab };
  if (q.offerId) where.offerId = q.offerId;
  if (q.stage) where.attemptsSinceLastCall = followUpStageRange(q.stage);
  if (q.month && q.tab !== "SEGUIMIENTO") {
    const r = monthRange(q.month, q.timeZone ?? BOGOTA);
    where[q.tab === "CERRADO" ? "closedAt" : "lostAt"] = { gte: r.start, lt: r.end };
  }
  const rows = await db.lead.findMany({
    where: q.cursor ? { AND: [where, afterCursor(q.cursor)] } : where,
    orderBy: [{ lastContactAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: take + 1, // one extra row only to know whether «Ver 10 más» shows
    select: PERSON_ROW_SELECT,
  });
  const page: PersonRow[] = rows.slice(0, take).map(personRow);
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: rows.length > take && last ? { lastContactAt: last.lastContactAt, id: last.id } : null,
  };
}

/** Global search: every status, by normalized name, 10 rows. */
export async function searchPeople(db: Db, userId: string, text: string) {
  const needle = normalizeName(text);
  if (!needle) return [];
  const rows = await db.lead.findMany({
    where: { userId, nameNorm: { contains: needle } },
    orderBy: [{ lastContactAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: SEARCH_TAKE,
    select: PERSON_ROW_SELECT,
  });
  return rows.map(personRow);
}
