export type CrmPrefs = {
  followupGraceDays: number;
  commissionUnpaidDays: number;
  acuerdoSinPagoDays: number;
  timezone: string;
  digestHour: number;
  whatsappE164: string;
};

export function parseCrmPrefs(raw: unknown): CrmPrefs {
  const value = (raw || {}) as Record<string, unknown>;
  const n = (key: string, fallback: number) => {
    const v = Number(value[key]);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const hour = n("digestHour", 8);
  return {
    followupGraceDays: n("followupGraceDays", 3),
    commissionUnpaidDays: n("commissionUnpaidDays", 15),
    acuerdoSinPagoDays: n("acuerdoSinPagoDays", 3),
    timezone: String(value.timezone || "America/Lima"),
    digestHour: Math.min(23, hour),
    whatsappE164: String(value.whatsappE164 || "").trim(),
  };
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
