// Cached readers for screens (plan 2.3). userId goes as an argument: a cached
// function cannot read cookies()/headers(). Entries are tagged per user and
// invalidated by lib/write/invalidate.ts after each write.
import { unstable_cache } from "next/cache";
import { getPrisma } from "@/lib/prisma";
import type { DayKey } from "@/lib/time/bogota";
import { readFicha, readFichaDetail } from "./ficha";
import { readOfferMap } from "./offers";
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

export const getUserSettings = (userId: string) =>
  unstable_cache(() => readUserSettings(db(), userId), ["user-settings", userId], {
    tags: [tags.profile(userId)],
    revalidate: REVALIDATE.safety,
  })();

export const getTodayHeader = (userId: string, month: DayKey) =>
  unstable_cache(() => readTodayHeader(db(), userId, month), ["today-header", userId, month], {
    tags: [tags.stats(userId), tags.goal(userId)],
    revalidate: REVALIDATE.today,
  })();

export const getTodayList = (userId: string) =>
  unstable_cache(() => readTodayList(db(), userId), ["today-list", userId], {
    tags: [tags.leads(userId)],
    revalidate: REVALIDATE.today,
  })();

export const getPeoplePage = (userId: string, query: PeopleQuery) =>
  unstable_cache(() => readPeoplePage(db(), userId, query), ["people", userId, JSON.stringify(query)], {
    tags: [tags.leads(userId)],
    revalidate: REVALIDATE.safety,
  })();

export const getPeopleSearch = (userId: string, text: string) =>
  unstable_cache(() => searchPeople(db(), userId, text), ["people-search", userId, text], {
    tags: [tags.leads(userId)],
    revalidate: REVALIDATE.safety,
  })();

export const getFicha = (userId: string, leadId: string) =>
  unstable_cache(() => readFicha(db(), userId, leadId), ["ficha", userId, leadId], {
    tags: [tags.lead(userId, leadId)],
    revalidate: REVALIDATE.safety,
  })();

export const getFichaDetail = (userId: string, leadId: string) =>
  unstable_cache(() => readFichaDetail(db(), userId, leadId), ["ficha-detail", userId, leadId], {
    tags: [tags.lead(userId, leadId)],
    revalidate: REVALIDATE.safety,
  })();

export const getPending = (userId: string) =>
  unstable_cache(() => readPending(db(), userId), ["pending", userId], {
    tags: [tags.pending(userId)],
    revalidate: REVALIDATE.safety,
  })();

export const getOffers = (userId: string) =>
  unstable_cache(() => readOfferMap(db(), userId), ["offers", userId], {
    tags: [tags.offers(userId)],
    revalidate: REVALIDATE.safety,
  })();
