import type { PrismaClient } from "@prisma/client";
import { alertBucket, startOfDay } from "@/lib/crm-prefs";
import { userHasReadyCrm } from "@/lib/offer-commercial";
import { loadOffersForCrm } from "@/lib/crm-apply";
import { attachFollowupOptions } from "@/lib/followup-library";

function monthRange(at: Date) {
  const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const to = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { from, to };
}

function prevMonthRange(at: Date) {
  const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  return { from, to };
}

function inRange(date: Date | null, from: Date, to: Date) {
  if (!date) return false;
  return date >= from && date < to;
}

export async function crmDashboard(prisma: PrismaClient, userId: string) {
  const offers = await loadOffersForCrm(prisma, userId);
  const readyCrm = userHasReadyCrm(offers);
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const month = monthRange(now);
  const prev = prevMonthRange(now);

  const [calls, alerts, leads, commissions] = await Promise.all([
    prisma.callRecord.findMany({
      where: { userId, filingStatus: "confirmed" },
    }),
    prisma.leadAlert.findMany({
      where: { userId, resolvedAt: null },
      include: { lead: true },
      orderBy: { dueAt: "asc" },
    }),
    prisma.lead.findMany({ where: { userId } }),
    prisma.commission.findMany({ where: { userId } }),
  ]);

  const bucket = (from: Date, to: Date) => {
    const slice = calls.filter((row) => inRange(row.recordedAt || row.createdAt, from, to));
    const agendas = slice.filter((row) =>
      ["AGENDADO", "SHOW", "CIERRE VENTA", "ACUERDO SIN PAGO", "NO SHOW", "REPROGRAMA"].includes(
        row.estadoAgenda,
      ),
    ).length;
    const shows = slice.filter((row) =>
      ["SHOW", "CIERRE VENTA", "ACUERDO SIN PAGO"].includes(row.estadoAgenda),
    ).length;
    const noShows = slice.filter((row) => row.estadoAgenda === "NO SHOW").length;
    const reprogramadas = slice.filter((row) => row.estadoAgenda === "REPROGRAMA").length;
    const cierres = slice.filter((row) => row.estadoAgenda === "CIERRE VENTA").length;
    const calificados = slice.filter((row) => {
      const json = row.filingJson as { calificado?: boolean };
      return json?.calificado === true;
    });
    const cierresCal = calificados.filter((row) => row.estadoAgenda === "CIERRE VENTA").length;
    const ventas = slice.reduce((sum, row) => sum + (row.ventaTotal || 0), 0);
    const cash = slice.reduce((sum, row) => sum + (row.cashCollected || 0), 0);
    const ticket = cierres ? ventas / cierres : 0;
    return {
      agendas,
      shows,
      noShows,
      reprogramadas,
      cierres,
      showRate: agendas ? shows / agendas : 0,
      closeRate: shows ? cierres / shows : 0,
      closeRateCalificado: calificados.length ? cierresCal / calificados.length : 0,
      ticket,
      ventas,
      cash,
      cashPct: ventas ? cash / ventas : 0,
    };
  };

  const current = bucket(month.from, month.to);
  const previous = bucket(prev.from, prev.to);
  const all = bucket(new Date(0), new Date(8640000000000000));

  const followups = alerts.map((row) => {
    const { estado, days } = alertBucket(row.dueAt, now);
    return {
      id: row.id,
      estado,
      days,
      dueAt: row.dueAt.toISOString(),
      cliente: row.lead.name,
      telefono: row.lead.telefono,
      oferta: row.lead.offerName,
      tipo: row.type,
      acuerdo: row.lead.nextStep,
      contexto: row.contexto,
      enJuego: row.enJuego,
      canal: row.canal,
      mensajeSugerido: row.mensajeSugerido,
      question: row.question,
      intentos: row.intentos,
      libraryScriptId: row.libraryScriptId,
      objecion: row.lead.razonNoCierre || row.lead.objections || "",
    };
  });

  const vencidos = followups.filter((row) => row.estado === "VENCIDO").length;
  const hoy = followups.filter((row) => row.estado === "HOY").length;
  const enJuego = followups.reduce((sum, row) => sum + (row.enJuego || 0), 0);
  const cashPendiente = calls.reduce((sum, row) => sum + (row.saldoPendiente || 0), 0);
  const comisionPendiente = commissions
    .filter((row) => row.estado !== "COBRADA")
    .reduce((sum, row) => sum + Math.max(0, row.generada - row.cobrada), 0);
  const comisionGenerada = commissions.reduce((sum, row) => sum + row.generada, 0);
  const comisionCobrada = commissions.reduce((sum, row) => sum + row.cobrada, 0);
  const agendasHoy = calls.filter(
    (row) =>
      row.estadoAgenda === "AGENDADO" &&
      row.recordedAt &&
      row.recordedAt >= today &&
      row.recordedAt < tomorrow,
  ).length;
  const agendasFuturas = calls.filter(
    (row) => row.estadoAgenda === "AGENDADO" && row.recordedAt && row.recordedAt >= tomorrow,
  ).length;

  const followupsWithOptions = await attachFollowupOptions(prisma, userId, followups);

  const byOffer = new Map<string, { cierres: number; ventas: number; cash: number }>();
  for (const row of calls.filter((item) => inRange(item.recordedAt || item.createdAt, month.from, month.to))) {
    const key = row.offerName || "OTROS";
    const cur = byOffer.get(key) || { cierres: 0, ventas: 0, cash: 0 };
    if (row.estadoAgenda === "CIERRE VENTA") cur.cierres += 1;
    cur.ventas += row.ventaTotal || 0;
    cur.cash += row.cashCollected || 0;
    byOffer.set(key, cur);
  }

  const razones = new Map<string, number>();
  const etapas = new Map<string, number>();
  for (const lead of leads) {
    if (lead.razonNoCierre) {
      razones.set(lead.razonNoCierre, (razones.get(lead.razonNoCierre) || 0) + 1);
    }
    if (lead.etapaPerdida) {
      etapas.set(lead.etapaPerdida, (etapas.get(lead.etapaPerdida) || 0) + 1);
    }
  }

  const monthly: { mes: string; agendas: number; shows: number; cierres: number; ventas: number; cash: number }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    const b = bucket(from, to);
    monthly.push({
      mes: from.toISOString().slice(0, 7),
      agendas: b.agendas,
      shows: b.shows,
      cierres: b.cierres,
      ventas: b.ventas,
      cash: b.cash,
    });
  }

  return {
    readyCrm,
    now: {
      seguimientosVencidos: vencidos,
      seguimientosHoy: hoy,
      agendasHoy,
      dineroEnJuego: enJuego,
      cashPendiente,
      comisionPendiente,
      oportunidadesActivas: leads.filter((row) =>
        ["seguimiento", "pendiente", "cobro", "nuevo"].includes(row.status),
      ).length,
      agendasFuturas,
    },
    rendimiento: { mes: current, anterior: previous, acumulado: all },
    desglose: {
      porOferta: [...byOffer.entries()].map(([oferta, stats]) => ({ oferta, ...stats })),
      embudo: {
        agendas: current.agendas,
        shows: current.shows,
        cierres: current.cierres,
      },
      razonNoCierre: [...razones.entries()].map(([razon, count]) => ({ razon, count })),
      etapaPerdida: [...etapas.entries()].map(([etapa, count]) => ({ etapa, count })),
    },
    evolucion: monthly,
    followups: followupsWithOptions,
    commissions: commissions.map((row) => ({
      id: row.id,
      fecha: row.fecha.toISOString(),
      oferta: row.oferta,
      venta: row.venta,
      cash: row.cash,
      pct: row.pctAplicado,
      generada: row.generada,
      cobrada: row.cobrada,
      estado: row.estado,
      fechaCobro: row.fechaCobro?.toISOString() || null,
    })),
    comisionResumen: {
      generada: comisionGenerada,
      cobrada: comisionCobrada,
      pendiente: comisionPendiente,
      pctCobrado: comisionGenerada ? comisionCobrada / comisionGenerada : 0,
    },
    leads: leads.slice(0, 80),
  };
}
