import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

export type CrmPrefs = {
  followupGraceDays: number;
  commissionUnpaidDays: number;
  acuerdoSinPagoDays: number;
  timezone: string;
  digestHour: number;
  whatsappE164: string;
  monthlyGoalUsd: number | null;
};

export function parseCrmPrefs(raw: unknown): CrmPrefs {
  const value = (raw || {}) as Record<string, unknown>;
  const n = (key: string, fallback: number) => {
    const v = Number(value[key]);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const hour = n("digestHour", 8);
  const goalRaw = value.monthlyGoalUsd;
  const goal = Number(goalRaw);
  return {
    followupGraceDays: n("followupGraceDays", 3),
    commissionUnpaidDays: n("commissionUnpaidDays", 15),
    acuerdoSinPagoDays: n("acuerdoSinPagoDays", 3),
    timezone: String(value.timezone || "America/Lima"),
    digestHour: Math.min(23, hour),
    whatsappE164: String(value.whatsappE164 || "").trim(),
    monthlyGoalUsd:
      goalRaw == null || goalRaw === "" || !Number.isFinite(goal) || goal <= 0
        ? null
        : Math.round(goal),
  };
}

export function parseMonthlyGoalUsd(text: string): number | null {
  const raw = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;
  const mentionsGoal = /meta|ganar|comisi[oó]n|mes|quiero|usd|\$|d[oó]lar/.test(raw);
  if (raw.length > 120 && !mentionsGoal) return null;
  if (raw.length > 40 && !mentionsGoal) return null;

  const mil = raw.match(/(\d+(?:[.,]\d+)?)\s*mil\b/);
  if (mil) {
    const n = Number(mil[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  }

  const grouped = raw.match(/(\d{1,3}(?:[.\s]\d{3})+)/);
  if (grouped) {
    const n = Number(grouped[1].replace(/[.\s]/g, ""));
    if (Number.isFinite(n) && n >= 100) return n;
  }

  const plain = raw.match(/(?:usd|\$)?\s*(\d{3,6})\b/);
  if (plain) {
    const n = Number(plain[1]);
    if (Number.isFinite(n) && n >= 100) return n;
  }
  return null;
}

export async function saveMonthlyGoal(
  prisma: PrismaClient,
  userId: string,
  usd: number,
) {
  const amount = Math.round(usd);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmPrefs: true },
  });
  const prefs = {
    ...((user?.crmPrefs && typeof user.crmPrefs === "object"
      ? user.crmPrefs
      : {}) as Record<string, unknown>),
    monthlyGoalUsd: amount,
  };
  await prisma.user.update({
    where: { id: userId },
    data: { crmPrefs: prefs as Prisma.InputJsonValue },
  });
  return amount;
}

export function addDays(from: Date, days: number) {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function parseFollowupDate(raw: string | null, fallback: Date) {
  if (!raw) return null;
  const text = raw.trim();
  const iso = text.length <= 10 ? `${text}T12:00:00.000Z` : text.replace(" ", "T");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function alertBucket(dueAt: Date, now = new Date()) {
  const due = startOfDay(dueAt).getTime();
  const today = startOfDay(now).getTime();
  const days = Math.round((due - today) / 86_400_000);
  if (days < 0) return { estado: "VENCIDO" as const, days };
  if (days === 0) return { estado: "HOY" as const, days };
  return { estado: "PRÓXIMO" as const, days };
}
