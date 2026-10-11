// Metas copy helpers. Display only: no arithmetic on amounts here.
import type { GoalPath, Trend } from "@/lib/metrics";
import { type DayKey, addDaysKey } from "@/lib/time/bogota";
import { formatCents } from "./money";

export const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_SHORT = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."];

const monthIndex = (day: DayKey) => Number(day.slice(5, 7)) - 1;
export const monthName = (day: DayKey) => MONTHS[monthIndex(day)];
export const monthShort = (day: DayKey) => MONTHS_SHORT[monthIndex(day)];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** «Octubre 2026» */
export const monthTitle = (day: DayKey) => `${cap(monthName(day))} ${day.slice(0, 4)}`;

/** «Del 5 al 11 de octubre · termina hoy» (crosses months: «Del 28 de septiembre al 4 de octubre»). */
export function weekLabel(weekStart: DayKey, today: DayKey) {
  const end = addDaysKey(weekStart, 6);
  const d = (k: DayKey) => Number(k.slice(8, 10));
  const range =
    weekStart.slice(5, 7) === end.slice(5, 7)
      ? `Del ${d(weekStart)} al ${d(end)} de ${monthName(end)}`
      : `Del ${d(weekStart)} de ${monthName(weekStart)} al ${d(end)} de ${monthName(end)}`;
  return `${range} · ${today === end ? "termina hoy" : "termina el domingo"}`;
}

export const daysText = (n: number) => (n === 1 ? "queda 1 día" : `quedan ${n} días`);

/** «2 de Círculo Millonario» / «1 de Círculo Millonario + 3 de Fertilidad Consciente» */
export const pathTitle = (p: GoalPath) => p.closes.map((c) => `${c.count} de ${c.offerName}`).join(" + ");

/** «2 cierres de Círculo Millonario» for the intro sentence. */
export function pathPhrase(p: GoalPath) {
  return p.closes.map((c) => `${c.count} ${c.count === 1 ? "cierre" : "cierres"} de ${c.offerName}`).join(" + ");
}

/** «USD 900 de comisión cada uno» / «USD 900 por Círculo Millonario · USD 300 por Fertilidad Consciente» */
export function pathDetail(p: GoalPath, perClose: Map<string, number | null>, currency: string) {
  if (p.closes.length === 1) {
    const c = p.closes[0];
    const each = formatCents(perClose.get(c.offerId) ?? null, currency);
    return `${each} de comisión ${c.count === 1 ? "" : "cada uno"}`.trim();
  }
  return p.closes.map((c) => `${formatCents(perClose.get(c.offerId) ?? null, currency)} por ${c.offerName}`).join(" · ");
}

/** «↑ 16 en sept.» / «= 6 en sept.» */
export function trendText(trend: Trend | null, previous: string | null, prevMonth: DayKey) {
  if (trend === null || previous === null) return null;
  const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "=";
  return `${arrow} ${previous} en ${monthShort(prevMonth)}`;
}

export const rateText = (r: { won: number; decided: number } | null) => (r ? `${r.won} de ${r.decided}` : "—");

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "·";
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}
