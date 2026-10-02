import type { PrismaClient } from "@prisma/client";
import { alertBucket, startOfDay } from "@/lib/crm-prefs";
import { alignFollowups, followupSnapshot } from "@/lib/crm-followups";
import { zonedDayKey } from "@/lib/crm-time";
import { userHasReadyCrm, type OfferForCrm } from "@/lib/offer-commercial";
import { loadOffersForCrm, repairMissingFollowups } from "@/lib/crm-apply";
import { attachFollowupOptions } from "@/lib/followup-library";
import { cleanReason, operacionFromCall } from "@/lib/crm-operacion";
import { isNonSalesCall } from "@/lib/call-kind";
import { leadTemperature, temperatureAction, temperatureRank } from "@/lib/lead-temperature";
import { presentThread } from "@/lib/followup-threads";

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
  try {
    await repairMissingFollowups(prisma, userId);
  } catch (error) {
    console.error("repair followups", error);
  }
  const offers = await loadOffersForCrm(prisma, userId);
  const readyCrm = userHasReadyCrm(offers);
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const month = monthRange(now);
  const prev = prevMonthRange(now);

  const [calls, allCalls, alerts, leads, commissions] = await Promise.all([
    prisma.callRecord.findMany({
      where: { userId, filingStatus: "confirmed" },
    }),
    prisma.callRecord.findMany({
      where: { userId, filingStatus: { not: "skipped" } },
      orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
      take: 2000,
    }),
    prisma.leadAlert.findMany({
      where: { userId, resolvedAt: null },
      include: { lead: true },
      orderBy: { dueAt: "asc" },
    }),
    prisma.lead.findMany({ where: { userId } }),
    prisma.commission.findMany({
      where: { userId },
      include: { lead: true },
      orderBy: { fecha: "desc" },
    }),
  ]);

  await reconcileOfferNames(prisma, offers, calls, allCalls, leads);

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

  const moneyByCall = new Map(
    allCalls.map((row) => [row.id, row.saldoPendiente || row.ventaTotal || 0]),
  );
  const sane = (amount: number | null | undefined) =>
    amount != null && amount > 0 && amount <= 1_000_000 ? amount : 0;
  const played = (alert: { enJuego: number; callRecordId: string | null }) =>
    sane(alert.enJuego) || sane(moneyByCall.get(alert.callRecordId || "")) || 0;

  const threads = await prisma.followupThread.findMany({
    where: { userId, estado: "activo" },
    include: {
      lead: true,
      touches: { orderBy: { fecha: "desc" }, take: 1 },
    },
  });
  const alertByThread = new Map(
    alerts.filter((row) => row.threadId).map((row) => [row.threadId as string, row]),
  );
  const threadRows = threads.flatMap((thread) => {
    const alert = alertByThread.get(thread.id);
    if (!alert) return [];
    const view = presentThread({
      tipo: thread.tipo,
      pasoActual: thread.pasoActual,
      askLost: thread.askLost,
      startedAt: thread.startedAt,
      pagoAt: thread.pagoAt,
      meetingAt: thread.meetingAt,
      enJuego: played(alert),
      lastTouch: thread.touches[0] || null,
      now,
    });
    const silenceDays = thread.touches[0]
      ? Math.max(0, Math.round((now.getTime() - thread.touches[0].fecha.getTime()) / 86_400_000))
      : 0;
    const temperatura = leadTemperature({
      enJuego: played(alert),
      silenceDays,
      calificado: thread.lead.calificado,
      objectionOpen: Boolean((thread.lead.razonNoCierre || thread.lead.objections || "").trim()),
      decisionDate: thread.tipo === "DECISION" || thread.tipo === "COBRANZA",
      intentos: thread.pasoActual,
    }).level;
    const presented = alertBucket(new Date(view.dueAt), now);
    return [
      {
        id: alert.id,
        estado: presented.estado,
        days: Math.max(0, presented.days),
        dueAt: view.dueAt,
        cliente: thread.lead.name,
        telefono: thread.lead.telefono,
        oferta: thread.lead.offerName,
        tipo: view.scriptType,
        hilo: view.hilo,
        paso: view.paso,
        ultimoToque: view.ultimoToque,
        proximaAccion: view.proximaAccion,
        askLost: view.askLost,
        acuerdo: view.proximaAccion,
        contexto: alert.contexto,
        enJuego: played(alert),
        canal: view.canal,
        mensajeSugerido: alert.mensajeSugerido,
        question: alert.question,
        intentos: thread.pasoActual,
        libraryScriptId: alert.libraryScriptId,
        objecion: thread.lead.razonNoCierre || thread.lead.objections || "",
        temperatura,
      },
    ];
  });
  const followups = [
    ...threadRows,
    ...alerts
      .filter((row) => !row.threadId)
      .map((row) => {
        const { estado, days } = alertBucket(row.dueAt, now);
        const silenceDays = days < 0 ? -days : 0;
        const decisionDate = row.type === "DECISION" || row.type === "PAGO PENDIENTE";
        const temperatura = leadTemperature({
          enJuego: played(row),
          silenceDays,
          calificado: row.lead.calificado,
          objectionOpen: Boolean((row.lead.razonNoCierre || row.lead.objections || "").trim()),
          decisionDate,
          intentos: row.intentos,
        }).level;
        const ultimoToque = days < 0 ? "vencido" : days === 0 ? "hoy" : `en ${days} días`;
        return {
          id: row.id,
          estado,
          days: Math.max(0, days),
          dueAt: row.dueAt.toISOString(),
          cliente: row.lead.name,
          telefono: row.lead.telefono,
          oferta: row.lead.offerName,
          tipo: row.type,
          hilo: row.type,
          paso: "—",
          ultimoToque,
          proximaAccion: "",
          askLost: false,
          acuerdo: row.lead.nextStep,
          contexto: row.contexto,
          enJuego: played(row),
          canal: row.canal,
          mensajeSugerido: row.mensajeSugerido,
          question: row.question,
          intentos: row.intentos,
          libraryScriptId: row.libraryScriptId,
          objecion: row.lead.razonNoCierre || row.lead.objections || "",
          temperatura,
        };
      }),
  ];

  const leadByName = new Map(leads.map((lead) => [lead.name.trim().toLowerCase(), lead]));
  const operacion = allCalls
    .filter((row) => !isNonSalesCall(row.estadoAgenda))
    .map((row) =>
      operacionFromCall(
        row,
        leadByName.get((row.leadName || "").trim().toLowerCase()) || null,
      ),
    );
  const todayKey = zonedDayKey(now);
  const openFollowups = alignFollowups(followups, operacion, todayKey, (draft) => ({
    id: `call:${draft.source.id}`,
    estado: draft.estado,
    days: Math.max(0, draft.days),
    dueAt: draft.dueAt,
    cliente: draft.source.cliente,
    telefono: draft.source.telefono,
    oferta: draft.source.oferta,
    tipo: draft.source.tipoSeguimiento || "SEGUIMIENTO",
    hilo: draft.source.tipoSeguimiento || "SEGUIMIENTO",
    paso: "—",
    ultimoToque: draft.ultimoToque,
    proximaAccion: draft.proximaAccion,
    askLost: false,
    acuerdo: draft.source.acuerdo,
    contexto: draft.source.acuerdo,
    enJuego: draft.enJuego,
    canal: "WHATSAPP",
    mensajeSugerido: "",
    question: draft.proximaAccion,
    intentos: 0,
    libraryScriptId: "",
    objecion: "",
    temperatura: leadTemperature({
      enJuego: draft.enJuego,
      silenceDays: draft.days < 0 ? -draft.days : 0,
      calificado: null,
      objectionOpen: false,
      decisionDate: draft.estado !== "PRÓXIMO",
      intentos: 0,
    }).level,
  }));
  const counts = followupSnapshot(openFollowups);
  const vencidos = counts.seguimientosVencidos;
  const hoy = counts.seguimientosHoy;
  const enJuego = counts.dineroEnJuego;
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

  const followupsWithOptions = (await attachFollowupOptions(prisma, userId, openFollowups))
    .map((row) => ({
      ...row,
      queHacer: row.proximaAccion || temperatureAction(row.temperatura, row.opciones?.[0]?.recomendacion || ""),
    }))
    .sort(
      (a, b) =>
        temperatureRank(b.temperatura) - temperatureRank(a.temperatura) ||
        (b.enJuego || 0) - (a.enJuego || 0) ||
        String(a.dueAt).localeCompare(String(b.dueAt)),
    );

  const byOffer = new Map<string, { cierres: number; ventas: number; cash: number }>();
  for (const offer of offers) {
    if (!byOffer.has(offer.productName)) {
      byOffer.set(offer.productName, { cierres: 0, ventas: 0, cash: 0 });
    }
  }
  for (const row of calls.filter((item) => inRange(item.recordedAt || item.createdAt, month.from, month.to))) {
    const knownName = strictOfferName(offers, row.offerName);
    if (!knownName) continue;
    const cur = byOffer.get(knownName) || { cierres: 0, ventas: 0, cash: 0 };
    if (row.estadoAgenda === "CIERRE VENTA") cur.cierres += 1;
    cur.ventas += row.ventaTotal || 0;
    cur.cash += row.cashCollected || 0;
    byOffer.set(knownName, cur);
  }

  const razones = new Map<string, number>();
  const etapas = new Map<string, number>();
  for (const lead of leads) {
    const razon = cleanReason(lead.razonNoCierre);
    if (razon) {
      razones.set(razon, (razones.get(razon) || 0) + 1);
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
      cliente: row.lead?.name || "",
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
    offers: offers.map((row) => ({
      id: row.id,
      productName: row.productName,
      currency: row.commercial.currency || "USD",
    })),
    operacion,
  };
}

function foldOffer(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function strictOfferName(offers: OfferForCrm[], raw: string | null | undefined) {
  const needle = foldOffer(String(raw || ""));
  if (!needle) return "";
  for (const offer of offers) {
    const names = [offer.productName, ...(offer.commercial?.aliases || [])];
    if (names.some((name) => foldOffer(name) === needle)) return offer.productName;
  }
  return "";
}

function resolvedOfferName(raw: string, filing: unknown, offers: OfferForCrm[]) {
  const known = strictOfferName(offers, raw);
  if (known) return known;
  const producto = (filing as { producto?: string } | null)?.producto || "";
  return strictOfferName(offers, producto);
}

/** Drop offer names that are not in the closer's list, and fold "Otro o null". */
async function reconcileOfferNames(
  prisma: PrismaClient,
  offers: Awaited<ReturnType<typeof loadOffersForCrm>>,
  calls: { id: string; offerName: string; filingJson: unknown }[],
  allCalls: { id: string; offerName: string; filingJson: unknown }[],
  leads: { id: string; offerName: string; razonNoCierre: string }[],
) {
  const jobs: Promise<unknown>[] = [];
  const written = new Set<string>();
  const queue = (key: string, job: Promise<unknown>) => {
    if (written.has(key) || jobs.length >= 40) return;
    written.add(key);
    jobs.push(job);
  };
  for (const row of [...calls, ...allCalls]) {
    const next = resolvedOfferName(row.offerName || "", row.filingJson, offers);
    if (next === (row.offerName || "")) continue;
    row.offerName = next;
    queue(
      `call:${row.id}`,
      prisma.callRecord.update({ where: { id: row.id }, data: { offerName: next } }),
    );
  }
  for (const lead of leads) {
    const nextOffer = resolvedOfferName(lead.offerName || "", null, offers);
    if (nextOffer !== (lead.offerName || "")) {
      lead.offerName = nextOffer;
      queue(
        `lead-offer:${lead.id}`,
        prisma.lead.update({ where: { id: lead.id }, data: { offerName: nextOffer } }),
      );
    }
    const reason = cleanReason(lead.razonNoCierre);
    if (reason && reason !== lead.razonNoCierre) {
      lead.razonNoCierre = reason;
      queue(
        `lead-reason:${lead.id}`,
        prisma.lead.update({ where: { id: lead.id }, data: { razonNoCierre: reason } }),
      );
    }
  }
  if (jobs.length) await Promise.all(jobs);
}
