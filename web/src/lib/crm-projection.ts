import type { PrismaClient } from "@prisma/client";
import { crmDashboard } from "@/lib/crm-metrics";
import { loadOffersForCrm } from "@/lib/crm-apply";
import { defaultCommissionRule } from "@/lib/offer-commercial";
import { commissionOnAmount } from "@/lib/commission";

function businessDaysLeft(until: Date, from = new Date()) {
  let count = 0;
  const cursor = new Date(from);
  cursor.setUTCHours(12, 0, 0, 0);
  const end = new Date(until);
  end.setUTCHours(12, 0, 0, 0);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Math.max(1, count);
}

export async function projectCommission(
  prisma: PrismaClient,
  userId: string,
  args: { metaUsd: number; until: Date; offerName?: string },
) {
  const dash = await crmDashboard(prisma, userId);
  const offers = await loadOffersForCrm(prisma, userId);
  const offer =
    offers.find((row) =>
      args.offerName
        ? row.productName.toLowerCase().includes(args.offerName.toLowerCase())
        : true,
    ) || offers[0];
  const rule = offer?.commercial.commission || defaultCommissionRule();
  const stats = dash.rendimiento.mes.agendas
    ? dash.rendimiento.mes
    : dash.rendimiento.acumulado.agendas
      ? dash.rendimiento.acumulado
      : {
          showRate: 0.7,
          closeRate: 0.27,
          ticket: offer?.commercial.listPrice || 10_000,
          cashPct: 0.4,
          agendas: 0,
          shows: 0,
          cierres: 0,
          ventas: 0,
          cash: 0,
        };

  const showRate = stats.showRate || 0.7;
  const closeRate = stats.closeRate || 0.27;
  const ticket = stats.ticket || offer?.commercial.listPrice || 10_000;
  const cashPct = stats.cashPct || 0.4;

  const pendienteCobro = dash.comisionResumen.pendiente;
  const saldoLeads = dash.now.cashPendiente;
  const comisionSobreSaldo = commissionOnAmount({
    rule,
    accumulatedBefore: dash.rendimiento.mes.cash,
    amount: saldoLeads,
  }).generada;
  const asegurada = pendienteCobro + comisionSobreSaldo;
  const nueva = Math.max(0, args.metaUsd - asegurada);

  const pct = rule.pctBase || 0.03;
  const cashNuevo = nueva > 0 ? nueva / pct : 0;
  const ventasNuevas = cashPct > 0 ? cashNuevo / cashPct : cashNuevo;
  const cierres = ticket > 0 ? Math.ceil(ventasNuevas / ticket) : 0;
  const shows = closeRate > 0 ? Math.ceil(cierres / closeRate) : cierres;
  const agendas = showRate > 0 ? Math.ceil(shows / showRate) : shows;
  const days = businessDaysLeft(args.until);
  const agendasPorDia = agendas / days;

  const mejorClose = Math.min(0.9, closeRate + 0.08);
  const showsMejor = mejorClose > 0 ? Math.ceil(cierres / mejorClose) : shows;
  const agendasMejor = showRate > 0 ? Math.ceil(showsMejor / showRate) : agendas;

  const topFollowups = dash.followups
    .slice()
    .sort((a, b) => b.enJuego - a.enJuego)
    .slice(0, 3);

  const lines = [
    `Para USD ${args.metaUsd.toLocaleString("es")} de comisión antes del ${args.until.toISOString().slice(0, 10)}:`,
    asegurada > 0
      ? `- Ya tienes USD ${Math.round(asegurada)} asegurados si cobras saldos pendientes.`
      : "- No hay comisión asegurada todavía.",
    nueva <= 0
      ? "- Ya la tienes: solo cobra lo pendiente."
      : `- Te faltan USD ${Math.round(nueva)} → ${cierres} cierres${offer ? ` de ${offer.productName}` : ""} → ${shows} shows → ${agendas} agendas.`,
    `- Quedan ${days} días hábiles: **${agendasPorDia.toFixed(1)} agendas/día**.`,
    topFollowups.length
      ? `- Palanca más rápida: ${topFollowups.map((row) => `${row.cliente} (${row.tipo}, USD ${row.enJuego})`).join("; ")}.`
      : "",
  ].filter(Boolean);

  return {
    metaUsd: args.metaUsd,
    until: args.until.toISOString(),
    asegurada,
    nueva,
    cierres,
    shows,
    agendas,
    days,
    agendasPorDia,
    rates: { showRate, closeRate, ticket, cashPct, pct },
    palancas: [
      { id: "cobrar", text: `Cobrar lo pendiente (USD ${Math.round(saldoLeads)} de saldo, comisión ~USD ${Math.round(pendienteCobro)}).` },
      {
        id: "seguimientos",
        text: `Cerrar seguimientos abiertos con más dinero en juego (${topFollowups.length} leads top).`,
      },
      {
        id: "close_rate",
        text: `Si subes el close rate de ${Math.round(closeRate * 100)}% a ${Math.round(mejorClose * 100)}% necesitas ${Math.max(0, agendas - agendasMejor)} agendas menos.`,
        href: "/coach",
      },
      { id: "agendar", text: `Agendar más: ${agendasPorDia.toFixed(1)} / día hábil.` },
    ],
    reply: lines.join("\n"),
  };
}
