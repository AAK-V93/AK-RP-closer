import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { ensureCrmTables } from "@/lib/prisma";
import { amountBandsFromFeedback } from "@/lib/offer-resolve";

export const FEEDBACK_BATCH = 10;

const STOP = new Set([
  "llamada",
  "meeting",
  "google",
  "meet",
  "zoom",
  "with",
  "para",
  "con",
  "the",
  "una",
  "del",
  "los",
  "las",
  "reunion",
  "reunión",
]);

export type LearnedRule = {
  token: string;
  count: number;
  valor: "NO_COMERCIAL";
};

export type ExtractorPattern = {
  summary: string;
  rules: LearnedRule[];
  builtAtCount: number;
};

export function titleTokens(title: string) {
  const words = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOP.has(word));
  return [...new Set(words)];
}

export function buildExtractorPattern(
  rows: { campo: string; valorCorregido: string; title: string }[],
): ExtractorPattern {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.campo !== "estado_agenda") continue;
    if (!/NO[_\s-]?COMERCIAL/i.test(row.valorCorregido)) continue;
    for (const token of titleTokens(row.title)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  const rules: LearnedRule[] = [...counts.entries()]
    .filter(([, count]) => count >= FEEDBACK_BATCH)
    .map(([token, count]) => ({ token, count, valor: "NO_COMERCIAL" as const }))
    .sort((a, b) => b.count - a.count);
  const summary = rules
    .map(
      (rule) =>
        `Este closer suele marcar como no comercial las llamadas tituladas "${rule.token}" sin producto mencionado.`,
    )
    .join(" ");
  return { summary, rules, builtAtCount: rows.length };
}

export function matchesLearnedNonCommercial(
  title: string,
  pattern: ExtractorPattern | null | undefined,
) {
  if (!pattern?.rules.length) return false;
  const tokens = new Set(titleTokens(title));
  return pattern.rules.some((rule) => tokens.has(rule.token));
}

export function readExtractorPattern(raw: unknown): ExtractorPattern | null {
  const prefs = (raw || {}) as { extractorPattern?: unknown };
  const value = prefs.extractorPattern;
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ExtractorPattern>;
  const rules = Array.isArray(row.rules)
    ? row.rules.filter(
        (rule): rule is LearnedRule =>
          Boolean(rule) &&
          typeof rule === "object" &&
          typeof (rule as LearnedRule).token === "string" &&
          (rule as LearnedRule).valor === "NO_COMERCIAL",
      )
    : [];
  return {
    summary: String(row.summary || ""),
    rules,
    builtAtCount: Number(row.builtAtCount) || 0,
  };
}

export function gapWeekCounts(dates: Date[], now = new Date()) {
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const thisMonday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset),
  );
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86_400_000);
  let thisWeek = 0;
  let lastWeek = 0;
  for (const date of dates) {
    const at = date.getTime();
    if (at >= thisMonday.getTime()) thisWeek += 1;
    else if (at >= lastMonday.getTime()) lastWeek += 1;
  }
  return { thisWeek, lastWeek };
}

export async function loadExtractorPattern(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmPrefs: true },
  });
  return readExtractorPattern(user?.crmPrefs);
}

export async function recordExtractorFeedback(
  prisma: PrismaClient,
  args: {
    userId: string;
    callRecordId: string;
    campo: string;
    valorExtraido: string;
    valorCorregido: string;
    title: string;
    force?: boolean;
  },
) {
  const before = String(args.valorExtraido || "").trim();
  const after = String(args.valorCorregido || "").trim();
  if (!after) return null;
  if (!args.force && before.toLowerCase() === after.toLowerCase()) return null;
  await ensureCrmTables(prisma);
  await prisma.extractorFeedback.create({
    data: {
      userId: args.userId,
      callRecordId: args.callRecordId,
      campo: args.campo,
      valorExtraido: before,
      valorCorregido: after,
    },
  });
  const total = await prisma.extractorFeedback.count({ where: { userId: args.userId } });
  if (total > 0 && total % FEEDBACK_BATCH === 0) {
    await rebuildExtractorPattern(prisma, args.userId);
  }
  return total;
}

export async function rebuildExtractorPattern(prisma: PrismaClient, userId: string) {
  const rows = await prisma.extractorFeedback.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const calls = await prisma.callRecord.findMany({
    where: { id: { in: rows.map((row) => row.callRecordId) } },
    select: { id: true, title: true },
  });
  const titles = new Map(calls.map((row) => [row.id, row.title]));
  const pattern = buildExtractorPattern(
    rows.map((row) => ({
      campo: row.campo,
      valorCorregido: row.valorCorregido,
      title: titles.get(row.callRecordId) || "",
    })),
  );
  pattern.builtAtCount = rows.length;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmPrefs: true },
  });
  const prefs = {
    ...((user?.crmPrefs && typeof user.crmPrefs === "object"
      ? user.crmPrefs
      : {}) as Record<string, unknown>),
    extractorPattern: pattern,
  };
  await prisma.user.update({
    where: { id: userId },
    data: { crmPrefs: prefs as Prisma.InputJsonValue },
  });
  return pattern;
}

export async function extractorGapWeeks(prisma: PrismaClient, userId: string, now = new Date()) {
  await ensureCrmTables(prisma);
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const rows = await prisma.extractorFeedback.findMany({
    where: { userId, createdAt: { gte: since } },
    select: { createdAt: true },
  });
  return gapWeekCounts(
    rows.map((row) => row.createdAt),
    now,
  );
}

const SALES = new Set(["SHOW", "CIERRE VENTA", "ACUERDO SIN PAGO"]);

export function learningRates(args: {
  calls: { id: string; offerName: string; estadoAgenda: string }[];
  feedback: { callRecordId: string; campo: string; valorExtraido: string; valorCorregido: string }[];
}) {
  const corrected = new Set(
    args.feedback.filter((row) => row.campo === "producto").map((row) => row.callRecordId),
  );
  const decided = args.calls.filter(
    (row) => SALES.has(row.estadoAgenda) && (row.offerName || corrected.has(row.id)),
  );
  const auto = decided.filter((row) => row.offerName && !corrected.has(row.id)).length;
  const temps = args.feedback.filter(
    (row) =>
      row.campo === "temperatura" &&
      (row.valorCorregido === "alto" || row.valorCorregido === "bajo"),
  );
  const hits = temps.filter((row) => row.valorExtraido === row.valorCorregido).length;
  return {
    offerAutoPct: decided.length ? Math.round((100 * auto) / decided.length) : null,
    temperatureHitPct: temps.length ? Math.round((100 * hits) / temps.length) : null,
  };
}

export async function loadOfferAmountBands(prisma: PrismaClient, userId: string) {
  try {
    await ensureCrmTables(prisma);
    const rows = await prisma.extractorFeedback.findMany({
      where: { userId, campo: "producto" },
      select: { valorExtraido: true, valorCorregido: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return amountBandsFromFeedback(rows);
  } catch {
    return [];
  }
}

export async function productLearningStats(prisma: PrismaClient, userId: string) {
  try {
    await ensureCrmTables(prisma);
    const [calls, feedback] = await Promise.all([
      prisma.callRecord.findMany({
        where: { userId, filingStatus: "confirmed" },
        select: { id: true, offerName: true, estadoAgenda: true },
        take: 500,
      }),
      prisma.extractorFeedback.findMany({
        where: { userId, campo: { in: ["producto", "temperatura"] } },
        select: {
          callRecordId: true,
          campo: true,
          valorExtraido: true,
          valorCorregido: true,
        },
        take: 500,
      }),
    ]);
    return learningRates({ calls, feedback });
  } catch {
    return { offerAutoPct: null, temperatureHitPct: null };
  }
}
