import type { PrismaClient } from "@prisma/client";
import { crmDashboard } from "@/lib/crm-metrics";
import { loadOffersForCrm } from "@/lib/crm-apply";
import { parseCrmPrefs } from "@/lib/crm-prefs";
import { zonedDayKey, zonedMidnight, zonedParts } from "@/lib/crm-time";
import { emptyCommercial, type CommissionRuleInput } from "@/lib/offer-commercial";
import { commissionOnAmount, resolveCommissionPct } from "@/lib/commission";

export const ASSUMED_SHOW_RATE = 0.6;
export const ASSUMED_CLOSE_RATE = 0.25;
export const ASSUMED_RATES_MIN_CALLS = 20;

function dayKeyParts(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

/** Weekdays from the Bogotá day of `from` through the Bogotá day of `until`, inclusive. */
function businessDaysLeft(until: Date, from = new Date()) {
  const startKey = zonedDayKey(from);
  const endKey = zonedDayKey(until);
  if (!startKey || !endKey || startKey > endKey) return 1;
  const start = dayKeyParts(startKey);
  const end = dayKeyParts(endKey);
  const cursor = zonedMidnight(start.year, start.month, start.day);
  const endAt = zonedMidnight(end.year, end.month, end.day);
  let count = 0;
  while (cursor.getTime() <= endAt.getTime()) {
    const weekday = new Date(`${zonedDayKey(cursor)}T12:00:00.000Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor.setTime(cursor.getTime() + 86_400_000);
  }
  return Math.max(1, count);
}

/** Noon UTC of the last calendar day of the Bogotá month, so the day does not flip at 19:00. */
export function endOfMonth(from = new Date()) {
  const { year, month } = zonedParts(from);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const last = new Date(zonedMidnight(nextYear, nextMonth, 1).getTime() - 86_400_000);
  const parts = zonedParts(last);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
}

export type ProjectionStats = {
  showRate: number;
  closeRate: number;
  ticket: number;
  cashPct: number;
  agendas: number;
  shows: number;
  cierres: number;
  ventas?: number;
  cash?: number;
};

export type ProjectionFollowup = {
  tipo: string;
  enJuego: number;
  cliente?: string;
};

export type ProjectionInput = {
  metaUsd: number;
  until: Date;
  now?: Date;
  realCallCount: number;
  comisionPendiente: number;
  cashPendiente: number;
  mesCash: number;
  stats: ProjectionStats;
  ticketFallback: number;
  commissionRule: CommissionRuleInput | null;
  followups: ProjectionFollowup[];
};

export type CommissionProjection = {
  metaUsd: number;
  until: string;
  asegurada: number;
  falta: number;
  nueva: number;
  cierres: number;
  shows: number;
  agendas: number;
  days: number;
  agendasPorDia: number;
  rates: { showRate: number; closeRate: number; ticket: number; cashPct: number; pct: number };
  usedAssumedRates: boolean;
  assumedRatesLabel: string | null;
  todayAction: string;
  palancas: { id: string; text: string; href?: string }[];
  reply: string;
};

function roundAgendasPerDay(value: number) {
  if (value <= 0) return 0;
  if (value < 1) return Math.round(value * 10) / 10;
  return Math.max(1, Math.round(value));
}

export function computeProjection(input: ProjectionInput): CommissionProjection {
  const usedAssumedRates = input.realCallCount < ASSUMED_RATES_MIN_CALLS;
  const showRate = usedAssumedRates
    ? ASSUMED_SHOW_RATE
    : input.stats.showRate || ASSUMED_SHOW_RATE;
  const closeRate = usedAssumedRates
    ? ASSUMED_CLOSE_RATE
    : input.stats.closeRate || ASSUMED_CLOSE_RATE;
  const ticket = input.stats.ticket || input.ticketFallback || 10_000;
  const cashPct = input.stats.cashPct || 0.4;
  const rule = input.commissionRule;
  const pct = rule ? resolveCommissionPct(rule, null) : 0;

  const comisionSobreSaldo = rule
    ? commissionOnAmount({
        rule,
        accumulatedBefore: input.mesCash,
        amount: input.cashPendiente,
      }).generada
    : 0;
  const asegurada = input.comisionPendiente + comisionSobreSaldo;
  const falta = Math.max(0, input.metaUsd - asegurada);
  const nueva = falta;

  let cierres = 0;
  let shows = 0;
  let agendas = 0;
  if (falta > 0 && pct > 0) {
    const cashNuevo = falta / pct;
    const ventasNuevas = cashPct > 0 ? cashNuevo / cashPct : cashNuevo;
    cierres = ticket > 0 ? Math.ceil(ventasNuevas / ticket) : 0;
    shows = closeRate > 0 ? Math.ceil(cierres / closeRate) : cierres;
    agendas = showRate > 0 ? Math.ceil(shows / showRate) : shows;
  }

  const days = businessDaysLeft(input.until, input.now);
  const agendasPorDia = agendas / days;
  const agendasHoy = roundAgendasPerDay(agendasPorDia);

  const decision = input.followups.filter((row) =>
    row.tipo.toUpperCase().includes("DECISION"),
  );
  const mejorClose = Math.min(0.9, closeRate + 0.08);
  const showsMejor = mejorClose > 0 ? Math.ceil(cierres / mejorClose) : shows;
  const agendasMejor = showRate > 0 ? Math.ceil(showsMejor / showRate) : agendas;

  let todayAction: string;
  if (falta <= 0) {
    todayAction =
      input.comisionPendiente > 0 || input.cashPendiente > 0
        ? "Cobra lo pendiente: ya cubres la meta."
        : "Ya cubres la meta de este mes.";
  } else if (decision.length > 0) {
    todayAction = `Cierra 1 de tus ${decision.length} seguimientos de decisión`;
  } else if (pct <= 0) {
    todayAction = "Define tu comisión en la oferta para calcular agendas/día.";
  } else {
    todayAction = `${agendasHoy} agendas/día`;
  }

  const assumedRatesLabel = usedAssumedRates
    ? `Usamos show ${Math.round(ASSUMED_SHOW_RATE * 100)}% / close ${Math.round(ASSUMED_CLOSE_RATE * 100)}% (menos de ${ASSUMED_RATES_MIN_CALLS} llamadas reales).`
    : null;

  const topFollowups = input.followups
    .slice()
    .sort((a, b) => b.enJuego - a.enJuego)
    .slice(0, 3);

  const lines = [
    `Para USD ${input.metaUsd.toLocaleString("es")} de comisión este mes:`,
    asegurada > 0
      ? `- Ya asegurado: USD ${Math.round(asegurada)} (comisión pendiente + saldos por cobrar).`
      : "- No hay comisión asegurada todavía.",
    falta <= 0
      ? "- Ya la tienes: solo cobra lo pendiente."
      : `- Te faltan USD ${Math.round(falta)}: ${cierres} cierres, ${shows} shows, ${agendas} agendas.`,
    todayAction ? `- Hoy: ${todayAction}.` : "",
    assumedRatesLabel ? `- ${assumedRatesLabel}` : "",
  ].filter(Boolean);

  return {
    metaUsd: input.metaUsd,
    until: input.until.toISOString(),
    asegurada,
    falta,
    nueva,
    cierres,
    shows,
    agendas,
    days,
    agendasPorDia,
    rates: { showRate, closeRate, ticket, cashPct, pct },
    usedAssumedRates,
    assumedRatesLabel,
    todayAction,
    palancas: [
      {
        id: "cobrar",
        text: `Cobrar lo pendiente (USD ${Math.round(input.cashPendiente)} de saldo, comisión ~USD ${Math.round(input.comisionPendiente)}).`,
      },
      {
        id: "seguimientos",
        text: `Cerrar seguimientos abiertos con más dinero en juego (${topFollowups.length} leads top).`,
      },
      {
        id: "close_rate",
        text: `Si subes el close rate de ${Math.round(closeRate * 100)}% a ${Math.round(mejorClose * 100)}% necesitas ${Math.max(0, agendas - agendasMejor)} agendas menos.`,
        href: "/coach",
      },
      { id: "agendar", text: `Agendar más: ${agendasHoy} / día hábil.` },
    ],
    reply: lines.join("\n"),
  };
}

export async function loadCommissionProjection(
  prisma: PrismaClient,
  userId: string,
  dash?: Awaited<ReturnType<typeof crmDashboard>>,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmPrefs: true },
  });
  const prefs = parseCrmPrefs(user?.crmPrefs);
  const offers = await loadOffersForCrm(prisma, userId);
  const needsMonthlyGoal = offers.some((row) => row.productName.trim()) && prefs.monthlyGoalUsd == null;
  if (!prefs.monthlyGoalUsd) {
    return {
      monthlyGoalUsd: null as number | null,
      needsMonthlyGoal,
      projection: null as CommissionProjection | null,
    };
  }
  const projection = await projectCommission(
    prisma,
    userId,
    {
      metaUsd: prefs.monthlyGoalUsd,
      until: endOfMonth(),
    },
    dash,
    offers,
  );
  return {
    monthlyGoalUsd: prefs.monthlyGoalUsd,
    needsMonthlyGoal: false,
    projection,
  };
}

export async function projectCommission(
  prisma: PrismaClient,
  userId: string,
  args: { metaUsd: number; until: Date; offerName?: string },
  dashLoaded?: Awaited<ReturnType<typeof crmDashboard>>,
  offersLoaded?: Awaited<ReturnType<typeof loadOffersForCrm>>,
) {
  const dash = dashLoaded || (await crmDashboard(prisma, userId));
  const offers = offersLoaded || (await loadOffersForCrm(prisma, userId));
  const offer =
    offers.find((row) =>
      args.offerName
        ? row.productName.toLowerCase().includes(args.offerName.toLowerCase())
        : true,
    ) || offers[0];
  const stats = dash.rendimiento.mes.agendas
    ? dash.rendimiento.mes
    : dash.rendimiento.acumulado.agendas
      ? dash.rendimiento.acumulado
      : {
          showRate: 0,
          closeRate: 0,
          ticket: offer?.commercial.listPrice || 10_000,
          cashPct: 0.4,
          agendas: 0,
          shows: 0,
          cierres: 0,
          ventas: 0,
          cash: 0,
        };

  const realCallCount = await prisma.callRecord.count({
    where: {
      userId,
      source: { in: ["fathom", "upload", "qc"] },
      filingStatus: { not: "skipped" },
    },
  });

  return computeProjection({
    metaUsd: args.metaUsd,
    until: args.until,
    realCallCount,
    comisionPendiente: dash.comisionResumen.pendiente,
    cashPendiente: dash.now.cashPendiente,
    mesCash: dash.rendimiento.mes.cash,
    stats,
    ticketFallback: offer?.commercial.listPrice || 10_000,
    commissionRule: offer?.commercial.commission || emptyCommercial().commission,
    followups: dash.followups.map((row) => ({
      tipo: row.tipo,
      enJuego: row.enJuego,
      cliente: row.cliente,
    })),
  });
}
