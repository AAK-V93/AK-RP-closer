import type { PrismaClient } from "@prisma/client";
import { alertBucket } from "@/lib/crm-prefs";
import { alignFollowups, applyClosedSaleFollowup, foldLeadName, followupSnapshot } from "@/lib/crm-followups";
import { countOportunidadesActivas, withEveryActiveLead } from "@/lib/crm-activa";
import { shiftZonedMonth, zonedDayBounds, zonedDayKey, zonedMonthRange } from "@/lib/crm-time";
import { userHasReadyCrm, type OfferForCrm } from "@/lib/offer-commercial";
import { loadOffersForCrm, repairMissingFollowups } from "@/lib/crm-apply";
import { attachFollowupOptions } from "@/lib/followup-library";
import { cleanReason, operacionFromCall } from "@/lib/crm-operacion";
import { leadTemperature, temperatureAction, temperatureRank } from "@/lib/lead-temperature";
import { presentThread } from "@/lib/followup-threads";
import { sequenceFor, stepDue, FOLLOWUP_SEQUENCES, type ThreadTipo } from "@/lib/followup-machine";
import { proximoFromInstant, suggestNextFollowup } from "@/lib/followup-desk";
import { explainVentas, offerPrices, rollupCalls, type RollupCall, type RollupOffer } from "@/lib/crm-rollup";
import { summarizePipeline } from "@/lib/crm-pipeline";
import { countedSale, shownBalance, shownMoney } from "@/lib/stated-deal";
import { applyCallRepair, planCallRepair, repairImportedCallFields } from "@/lib/call-normalize";
import { loadDashboardCalls } from "@/lib/crm-call-read";
import { catalogDisplayName, foldOffer, isInventedOfferLabel, isPriceLabel } from "@/lib/offer-name";

function inRange(date: Date | null, from: Date, to: Date) {
  if (!date) return false;
  return date >= from && date < to;
}

export type DashboardTiming = { name: string; dur: number };

function markTiming(timings: DashboardTiming[] | undefined, name: string, started: number) {
  timings?.push({ name, dur: Math.round(performance.now() - started) });
}

export async function crmDashboard(
  prisma: PrismaClient,
  userId: string,
  opts?: { scripts?: boolean; timings?: DashboardTiming[] },
) {
  const scripts = opts?.scripts !== false;
  const repairStarted = performance.now();
  try {
    await repairMissingFollowups(prisma, userId);
  } catch (error) {
    console.error("repair followups", error);
  }
  markTiming(opts?.timings, "repair", repairStarted);
  const callsStarted = performance.now();
  const offers = await loadOffersForCrm(prisma, userId);
  const readyCrm = userHasReadyCrm(offers);
  const now = new Date();
  const todayKey = zonedDayKey(now);
  const todayBounds = zonedDayBounds(now);
  const month = zonedMonthRange(now);
  const prev = shiftZonedMonth(now, -1);

  const [{ calls, allCalls }, alerts, leads, commissions] = await Promise.all([
    loadDashboardCalls(prisma, userId),
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
  markTiming(opts?.timings, "calls", callsStarted);

  const rollupOffers = offers.map(asRollupOffer);
  const nameHints = [...calls, ...allCalls].flatMap((row) => [
    row.offerName || "",
    filingProduct(row.filingJson),
  ]);
  const reconcileStarted = performance.now();
  try {
    await repairCatalogNames(prisma, offers, rollupOffers, nameHints);
  } catch (error) {
    console.error("repair offer name", error);
  }
  try {
    await reconcileOfferNames(prisma, offers, calls, allCalls, leads);
  } catch (error) {
    console.error("reconcile offers", error);
  }
  try {
    await persistDirtyCallRepairs(
      prisma,
      offers.map((offer) => offer.productName),
      [calls, allCalls],
    );
  } catch (error) {
    console.error("repair imported calls", error);
  }
  markTiming(opts?.timings, "reconcile", reconcileStarted);

  const rollupInput = calls.map(asRollupCall);
  const prices = offerPrices(offers.map(asRollupOffer));
  const bucket = (from: Date, to: Date) => {
    const slice = calls.filter((row) => inRange(row.recordedAt || row.createdAt, from, to));
    const rolled = rollupCalls(
      offers.map(asRollupOffer),
      rollupInput,
      { from, to },
    );
    const calificados = slice.filter((row) => {
      const json = row.filingJson as { calificado?: boolean };
      return json?.calificado === true;
    });
    const cierresCal = calificados.filter((row) => row.estadoAgenda === "CIERRE VENTA").length;
    const { porOferta: _rows, ...stats } = rolled;
    return {
      ...stats,
      closeRateCalificado: calificados.length ? cierresCal / calificados.length : 0,
    };
  };

  const current = bucket(month.from, month.to);
  const previous = bucket(prev.from, prev.to);
  const all = bucket(new Date(0), new Date(8640000000000000));

  const moneyByCall = new Map(
    allCalls.map((row) => [
      row.id,
      countedSale(row.saldoPendiente, { at: row.recordedAt || row.createdAt, prices }) ||
        countedSale(row.ventaTotal, { at: row.recordedAt || row.createdAt, prices }),
    ]),
  );
  const played = (alert: { enJuego: number; callRecordId: string | null }) =>
    countedSale(alert.enJuego, { prices }) || moneyByCall.get(alert.callRecordId || "") || 0;

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
    try {
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
    if (!view) return [];
    const presented = alertBucket(new Date(view.dueAt), now);
    const tipo = thread.tipo as ThreadTipo;
    const steps = tipo in FOLLOWUP_SEQUENCES ? sequenceFor(tipo).steps : [];
    const nextStep = steps[thread.pasoActual + 1];
    const nextOnHecho = nextStep
      ? proximoFromInstant(
          stepDue(
            nextStep,
            { start: thread.startedAt, pagoAt: thread.pagoAt, meetingAt: thread.meetingAt },
            now,
          ),
        )
      : "";
    return [
      {
        id: alert.id,
        leadId: thread.leadId,
        callId: alert.callRecordId || thread.creadoDesdeCallRecordId || "",
        proximo: "",
        closesOnHecho: !nextOnHecho,
        nextOnHecho,
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
        leadStatus: thread.lead.status,
      },
    ];
    } catch (error) {
      console.error("crm thread", thread.id, error);
      return [];
    }
  });
  const followups = [
    ...threadRows,
    ...alerts
      .filter((row) => !row.threadId)
      .flatMap((row) => {
        try {
        if (!row.dueAt || Number.isNaN(row.dueAt.getTime()) || !row.lead) return [];
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
        const keepsGoing = row.type === "PAGO PENDIENTE" || row.type === "COBRO_VENCIDO";
        return {
          id: row.id,
          leadId: row.leadId,
          callId: row.callRecordId || "",
          proximo: "",
          closesOnHecho: !keepsGoing,
          nextOnHecho: keepsGoing ? todayKey : "",
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
          leadStatus: row.lead.status,
        };
        } catch (error) {
          console.error("crm alert", row.id, error);
          return [];
        }
      }),
  ];

  const leadByName = new Map(leads.map((lead) => [lead.name.trim().toLowerCase(), lead]));
  const leadIdByCall = new Map<string, string>();
  for (const alert of alerts) {
    if (alert.callRecordId && alert.leadId) leadIdByCall.set(alert.callRecordId, alert.leadId);
  }
  for (const thread of threads) {
    if (thread.creadoDesdeCallRecordId && thread.leadId) {
      leadIdByCall.set(thread.creadoDesdeCallRecordId, thread.leadId);
    }
  }
  const statusByLead = new Map(leads.map((lead) => [foldLeadName(lead.name), lead.status]));
  const callRows = allCalls.flatMap((row) => {
    try {
      const view = operacionFromCall(
        row,
        leadByName.get((row.leadName || "").trim().toLowerCase()) || null,
      );
      const at = view.fecha ? `${view.fecha}T12:00:00.000Z` : row.recordedAt || row.createdAt;
      return [
        {
          ...view,
          leadId:
            leadIdByCall.get(row.id) ||
            String((row.filingJson as { lead_id?: string } | null)?.lead_id || ""),
          leadStatus: statusByLead.get(foldLeadName(view.cliente)) || "",
          venta: shownMoney(view.venta, { at, prices }),
          cash: shownMoney(view.cash, { at, prices }),
          saldo: shownBalance(view.venta, view.cash, view.saldo, { at, prices }),
        },
      ];
    } catch (error) {
      console.error("crm operacion", row.id, error);
      return [];
    }
  });
  const operacion = withEveryActiveLead(callRows, leads, (lead) => {
    const full = leads.find((row) => row.id === lead.id);
    const view = operacionFromCall(
      {
        id: `lead:${lead.id}`,
        leadName: lead.name,
        offerName: full?.offerName || "",
        filingStatus: "confirmed",
        filingJson: {},
      },
      full,
    );
    return {
      ...view,
      leadId: lead.id,
      leadStatus: lead.status,
      venta: null,
      cash: null,
      saldo: null,
    };
  });
  const openFollowups = alignFollowups(
    followups,
    operacion.filter((row) => !row.interna),
    todayKey,
    (draft) => ({
    id: `call:${draft.source.id}`,
    leadId: draft.source.leadId || "",
    callId: draft.source.id,
    proximo: draft.source.fechaProximo,
    closesOnHecho: true,
    nextOnHecho: "",
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
    estadoAgenda: draft.source.estadoAgenda || "",
    leadStatus: draft.source.leadStatus || "",
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
  const pipeline = summarizePipeline({
    leads: leads.map((lead) => ({
      id: lead.id,
      name: lead.name,
      status: lead.status,
      offerName: lead.offerName,
      amountTalked: lead.amountTalked,
      nextStepAt: lead.nextStepAt,
    })),
    calls: allCalls.map((row) => ({
      leadName: row.leadName,
      offerName: row.offerName,
      estadoAgenda: row.estadoAgenda,
      ventaTotal: row.ventaTotal,
      cashCollected: row.cashCollected,
      recordedAt: row.recordedAt,
      createdAt: row.createdAt,
      filingJson: row.filingJson,
    })),
    threads: threads.map((thread) => ({
      leadId: thread.leadId,
      tipo: thread.tipo,
      estado: thread.estado,
    })),
    offers: offers.map((offer) => ({
      productName: offer.productName,
      aliases: offer.commercial.aliases,
      listPrice: offer.commercial.listPrice,
      altPrices: offer.commercial.altPrices,
    })),
  });
  const enJuego = pipeline.pipeline.total;
  const cashPendiente = calls.reduce(
    (sum, row) =>
      sum + countedSale(row.saldoPendiente, { at: row.recordedAt || row.createdAt, prices }),
    0,
  );
  const comisionPendiente = commissions
    .filter((row) => row.estado !== "COBRADA")
    .reduce((sum, row) => sum + Math.max(0, row.generada - row.cobrada), 0);
  const comisionGenerada = commissions.reduce((sum, row) => sum + row.generada, 0);
  const comisionCobrada = commissions.reduce((sum, row) => sum + row.cobrada, 0);
  const agendasHoy = calls.filter(
    (row) =>
      row.estadoAgenda === "AGENDADO" &&
      row.recordedAt &&
      row.recordedAt >= todayBounds.from &&
      row.recordedAt < todayBounds.to,
  ).length;
  const agendasFuturas = calls.filter(
    (row) =>
      row.estadoAgenda === "AGENDADO" && row.recordedAt && row.recordedAt >= todayBounds.to,
  ).length;

  const scriptsStarted = performance.now();
  const withScripts = scripts
    ? await attachFollowupOptions(
        prisma,
        userId,
        openFollowups.map((row) => applyClosedSaleFollowup(row)),
      )
    : openFollowups.map((row) => ({
        ...applyClosedSaleFollowup(row),
        opciones: [] as { recomendacion?: string }[],
        selectedId: row.libraryScriptId || "",
      }));
  markTiming(opts?.timings, "scripts", scriptsStarted);
  const followupsWithOptions = withScripts
    .map((row) => ({
      ...row,
      suggestedNext: suggestNextFollowup(todayKey, row.proximo || ""),
      queHacer: row.proximaAccion || temperatureAction(row.temperatura, row.opciones?.[0]?.recomendacion || ""),
    }))
    .sort(
      (a, b) =>
        temperatureRank(b.temperatura) - temperatureRank(a.temperatura) ||
        (b.enJuego || 0) - (a.enJuego || 0) ||
        String(a.dueAt).localeCompare(String(b.dueAt)),
    );

  const allTime = rollupCalls(offers.map(asRollupOffer), rollupInput, {
    from: new Date(0),
    to: new Date(8640000000000000),
  });
  const ventasDetalle = explainVentas(rollupInput, prices);

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
    const range = shiftZonedMonth(now, -i);
    const b = bucket(range.from, range.to);
    monthly.push({
      mes: range.key,
      agendas: b.agendas,
      shows: b.shows,
      cierres: b.cierres,
      ventas: b.ventas,
      cash: b.cash,
    });
  }

  return {
    readyCrm,
    today: todayKey,
    now: {
      seguimientosVencidos: vencidos,
      seguimientosHoy: hoy,
      agendasHoy,
      dineroEnJuego: enJuego,
      pipelineLeads: pipeline.pipeline.count,
      saldoPorCobrar: pipeline.saldo,
      cashPendiente,
      comisionPendiente,
      oportunidadesActivas: countOportunidadesActivas(leads),
      agendasFuturas,
    },
    pipelineDetalle: pipeline.lines,
    rendimiento: { mes: current, anterior: previous, acumulado: all },
    ventasDetalle,
    desglose: {
      porOferta: allTime.porOferta,
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
    commissions: commissions.flatMap((row) => {
      try {
        if (!row.fecha || Number.isNaN(row.fecha.getTime())) return [];
        return [{
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
          fechaCobro: row.fechaCobro && !Number.isNaN(row.fechaCobro.getTime())
            ? row.fechaCobro.toISOString()
            : null,
        }];
      } catch (error) {
        console.error("crm commission", row.id, error);
        return [];
      }
    }),
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

function filingProduct(filing: unknown) {
  const producto = (filing as { producto?: string } | null)?.producto || "";
  return String(producto || "").trim();
}

function asRollupOffer(offer: OfferForCrm): RollupOffer {
  return {
    id: offer.id,
    productName: offer.productName,
    productDescription: offer.productDescription,
    aliases: offer.commercial.aliases,
    prices: [
      offer.commercial.listPrice || 0,
      ...offer.commercial.altPrices.map((row) => row.amount || 0),
    ].filter((price) => price > 0),
  };
}

function asRollupCall(row: {
  id?: string;
  leadName?: string | null;
  offerName?: string | null;
  estadoAgenda?: string | null;
  ventaTotal?: number | null;
  cashCollected?: number | null;
  recordedAt?: Date | null;
  createdAt?: Date | null;
  filingJson?: unknown;
}): RollupCall {
  const filing = (row.filingJson || {}) as {
    producto?: string;
    tipo_seguimiento?: string;
    acuerdo_seguimiento?: string;
    notas_crm?: string;
    evidencia?: { cierre?: string; venta_total?: string };
    lead_id?: string;
  };
  return {
    id: row.id,
    leadId: filing.lead_id || "",
    cliente: row.leadName,
    offerName: row.offerName,
    producto: filingProduct(row.filingJson),
    estadoAgenda: row.estadoAgenda,
    tipoSeguimiento: String(filing.tipo_seguimiento || ""),
    acuerdo: String(filing.acuerdo_seguimiento || ""),
    notas: String(filing.notas_crm || ""),
    evidenciaCierre: String(filing.evidencia?.cierre || ""),
    evidenciaVenta: String(filing.evidencia?.venta_total || ""),
    ventaTotal: row.ventaTotal,
    cashCollected: row.cashCollected,
    recordedAt: row.recordedAt,
    createdAt: row.createdAt,
  };
}

/** Apply field repairs in memory, and write back only the rows that changed. */
async function persistDirtyCallRepairs(
  prisma: PrismaClient,
  offerNames: string[],
  groups: {
    id: string;
    offerName?: string | null;
    estadoAgenda?: string | null;
    ventaTotal?: number | null;
    saldoPendiente?: number | null;
    cashCollected?: number | null;
    filingJson?: unknown;
  }[][],
) {
  const dirty = new Set<string>();
  for (const group of groups) {
    for (const row of group) {
      const repair = planCallRepair(row, offerNames);
      if (!repair) continue;
      applyCallRepair(row, repair);
      dirty.add(row.id);
    }
  }
  if (!dirty.size) return;
  const full = await prisma.callRecord.findMany({
    where: { id: { in: [...dirty].slice(0, 40) } },
    select: {
      id: true,
      offerName: true,
      estadoAgenda: true,
      ventaTotal: true,
      saldoPendiente: true,
      cashCollected: true,
      filingJson: true,
    },
  });
  await repairImportedCallFields(prisma, offerNames, [full]);
}

async function repairCatalogNames(
  prisma: PrismaClient,
  offers: OfferForCrm[],
  rollupOffers: RollupOffer[],
  hints: string[],
) {
  for (const offer of offers) {
    if (!isPriceLabel(offer.productName)) continue;
    const displayName = catalogDisplayName(
      {
        productName: offer.productName,
        productDescription: offer.productDescription,
        aliases: offer.commercial.aliases,
      },
      hints,
    );
    if (!displayName || foldOffer(displayName) === foldOffer(offer.productName)) continue;
    offer.productName = displayName;
    const shadow = rollupOffers.find((row) => row.id === offer.id);
    if (shadow) shadow.productName = displayName;
    await prisma.userOffer.update({
      where: { id: offer.id },
      data: { productName: displayName },
    });
  }
}

function strictOfferName(offers: OfferForCrm[], raw: string | null | undefined) {
  const needle = foldOffer(String(raw || ""));
  if (!needle || isPriceLabel(needle) || isInventedOfferLabel(needle)) return "";
  for (const offer of offers) {
    const names = [offer.productName, ...(offer.commercial?.aliases || [])];
    if (names.some((name) => foldOffer(name) === needle)) return offer.productName;
  }
  return "";
}

function resolvedOfferName(raw: string, filing: unknown, offers: OfferForCrm[]) {
  const known = strictOfferName(offers, raw);
  if (known) return known;
  const fromProducto = strictOfferName(offers, filingProduct(filing));
  if (fromProducto) return fromProducto;
  if (isPriceLabel(raw) || isInventedOfferLabel(raw)) return "";
  return raw;
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
