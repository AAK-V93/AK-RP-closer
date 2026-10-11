// Cached readers for screens (plan 2.3). userId goes as an argument: a cached
// function cannot read cookies()/headers(). Entries are tagged per user and
// invalidated by lib/write/invalidate.ts after each write.
// Reads that depend on «hoy» carry the Bogotá day in their key and expire
// after 600 s (midnight has no write to invalidate them).
import { unstable_cache } from "next/cache";
import { getPrisma } from "@/lib/prisma";
import type { DayKey } from "@/lib/time/bogota";
import { readFicha, readFichaDetail } from "./ficha";
import { readOfferCases, readOfferMap, readOfferScripts, readOffersPage } from "./offers";
import { type PeopleQuery, readPeoplePage, searchPeople } from "./people";
import { readPending } from "./pending";
import { REVALIDATE, tags } from "./tags";
import { readTodayHeader, readTodayList } from "./today";
import { readUserSettings } from "./user";

function db() {
  const prisma = getPrisma();
  if (!prisma) throw new Error("DATABASE_URL no está configurada");
  return prisma;
}

/** Hit-rate log for previews (Arquitectura, PR 2 review, E). No user data in the line. */
export function cacheLogEnabled() {
  return process.env.CACHE_LOG === "1" || process.env.VERCEL_ENV === "preview";
}

/**
 * unstable_cache + one log line per call: «[cache] name hit|miss ms».
 * The inner function only runs on a miss, which is how a hit is told apart.
 */
async function cachedRead<T>(
  name: string,
  keyParts: string[],
  options: { tags: string[]; revalidate: number },
  read: () => Promise<T>,
): Promise<T> {
  let missed = false;
  const started = Date.now();
  const value = await unstable_cache(
    async () => {
      missed = true;
      return read();
    },
    [name, ...keyParts],
    options,
  )();
  if (cacheLogEnabled()) console.info(`[cache] ${name} ${missed ? "miss" : "hit"} ${Date.now() - started}ms`);
  return value;
}

export const getUserSettings = (userId: string) =>
  cachedRead("user-settings", [userId], { tags: [tags.profile(userId)], revalidate: REVALIDATE.safety }, () =>
    readUserSettings(db(), userId),
  );

export const getTodayHeader = (userId: string, today: DayKey) =>
  cachedRead(
    "today-header",
    [userId, today],
    { tags: [tags.stats(userId), tags.goal(userId)], revalidate: REVALIDATE.today },
    () => readTodayHeader(db(), userId, `${today.slice(0, 7)}-01`),
  );

export const getTodayList = (userId: string, today: DayKey) =>
  cachedRead("today-list", [userId, today], { tags: [tags.leads(userId)], revalidate: REVALIDATE.today }, () =>
    readTodayList(db(), userId, today),
  );

export const getPeoplePage = (userId: string, query: PeopleQuery) =>
  cachedRead("people", [userId, JSON.stringify(query)], { tags: [tags.leads(userId)], revalidate: REVALIDATE.safety }, () =>
    readPeoplePage(db(), userId, query),
  );

export const getPeopleSearch = (userId: string, text: string) =>
  cachedRead("people-search", [userId, text], { tags: [tags.leads(userId)], revalidate: REVALIDATE.safety }, () =>
    searchPeople(db(), userId, text),
  );

export const getFicha = (userId: string, leadId: string) =>
  cachedRead("ficha", [userId, leadId], { tags: [tags.lead(userId, leadId)], revalidate: REVALIDATE.safety }, () =>
    readFicha(db(), userId, leadId),
  );

export const getFichaDetail = (userId: string, leadId: string) =>
  cachedRead("ficha-detail", [userId, leadId], { tags: [tags.lead(userId, leadId)], revalidate: REVALIDATE.safety }, () =>
    readFichaDetail(db(), userId, leadId),
  );

export const getPending = (userId: string) =>
  cachedRead("pending", [userId], { tags: [tags.pending(userId)], revalidate: REVALIDATE.safety }, () =>
    readPending(db(), userId),
  );

export const getOffers = (userId: string) =>
  cachedRead("offers", [userId], { tags: [tags.offers(userId)], revalidate: REVALIDATE.safety }, () =>
    readOfferMap(db(), userId),
  );

export const getOffersPage = (userId: string) =>
  cachedRead("offers-page", [userId], { tags: [tags.offers(userId)], revalidate: REVALIDATE.safety }, () =>
    readOffersPage(db(), userId),
  );

export const getOfferScripts = (userId: string, offerId: string, all: boolean) =>
  cachedRead(
    "offer-scripts",
    [userId, offerId, all ? "all" : "first"],
    { tags: [tags.offers(userId)], revalidate: REVALIDATE.safety },
    () => readOfferScripts(db(), userId, offerId, all),
  );

export const getOfferCases = (userId: string, offerId: string, all: boolean) =>
  cachedRead("offer-cases", [userId, offerId, all ? "all" : "first"], { tags: [tags.offers(userId)], revalidate: REVALIDATE.safety }, () =>
    readOfferCases(db(), userId, offerId, all),
  );
