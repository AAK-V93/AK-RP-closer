import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildFollowupCopy,
  collectionCopy,
  followupQuestion,
  type FollowupVars,
} from "@/lib/followup-scripts";
import { openFollowupThread } from "@/lib/followup-threads";
import { generateGeminiJson } from "@/lib/gemini";
import {
  enrichExtractorFollowup,
  extractorGap,
  extractorOneLiner,
  isExtractorJson,
  parseExtractorJson,
  type ExtractorJson,
} from "@/lib/extractor";
import { followupIsClosed } from "@/lib/crm-followups";
import { findMatchingLead } from "@/lib/lead-match";
import { resolveOpenAlertsForLead } from "@/lib/alerts";
import {
  deadlineDaysForPago,
  parseCommercial,
  type OfferForCrm,
  userHasReadyCrm,
} from "@/lib/offer-commercial";
import { applyProductoGuard, keptOfferName, offersCatalogOpen, type OfferRef } from "@/lib/producto-guard";
import { commissionOnAmount, periodStart } from "@/lib/commission";
import { addDays, parseCrmPrefs, parseFollowupDate, patchCrmPref } from "@/lib/crm-prefs";
import { canonicalTipo } from "@/lib/call-normalize";
import { inferCallDate, inferFollowupDate, isPasteHeading, pastedCallTitle } from "@/lib/followup-date";
import { zonedDayKey } from "@/lib/crm-time";
import { isNonSalesCall, normalizeEstadoAgenda } from "@/lib/call-kind";
import { statusFromEstadoAgenda } from "@/lib/crm-activa";
import { recordExtractorFeedback } from "@/lib/extractor-feedback";

function parseCrmReadyOffersImpl(
  rows: { id: string; productName: string; productDescription: string; commercial: unknown }[],
): OfferForCrm[] {
  return rows.map((row) => ({
    id: row.id,
    productName: row.productName,
    productDescription: row.productDescription,
    commercial: parseCommercial(row.commercial),
  }));
}

export async function loadOffersForCrm(prisma: PrismaClient, userId: string) {
  const rows = await prisma.userOffer.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return parseCrmReadyOffersImpl(rows);
}

export { userHasReadyCrm };

function leadStatusFromAgenda(estado: string | null) {
  return statusFromEstadoAgenda(estado);
}

function trainsBot(estado: string | null) {
  if (isNonSalesCall(estado)) return false;
  return estado === "SHOW" || estado === "CIERRE VENTA" || estado === "ACUERDO SIN PAGO";
}

function followupVars(args: {
  leadName: string;
  offerName: string;
  enJuego: number;
  acuerdo: string;
  paymentDetails: string;
  objecion?: string;
  fecha?: string;
  hints?: import("@/lib/followup-scripts").InstallmentHint[];
}): FollowupVars {
  const money = collectionCopy({
    saldo: args.enJuego,
    due: args.fecha,
    paymentDetails: args.paymentDetails,
    hints: args.hints,
  });
  return {
    nombre: args.leadName,
    programa: args.offerName,
    ...money,
    fecha: money.fecha || args.acuerdo || "",
    objecion: args.objecion || "",
    deseo: "",
    closer: "",
  };
}

export async function suggestedFollowupMessage(args: {
  leadName: string;
  offerName: string;
  tipo: string;
  acuerdo: string;
  notas: string;
  enJuego: number;
  paymentDetails: string;
  intentos?: number;
  customScripts?: import("@/lib/followup-scripts").FollowupScript[];
  objecion?: string;
  fecha?: string;
}) {
  const copy = buildFollowupCopy({
    type: args.tipo,
    intentos: args.intentos || 0,
    vars: followupVars(args),
    custom: args.customScripts,
  });
  const originId = copy.originId || "";
  if (copy.mensaje && copy.recomendacion) {
    return {
      mensaje: copy.asset ? `${copy.mensaje}\n${copy.asset}` : copy.mensaje,
      recomendacion: `${copy.canal}: ${copy.recomendacion}`,
      canal: copy.canal === "LLAMADA" ? "LLAMADA" : "WHATSAPP",
      originId,
    };
  }
  const fallback = copy.mensaje;
  try {
    const text = await generateGeminiJson(
      `Escribe UN mensaje de WhatsApp, en español, listo para copiar y enviar. Sin comillas. Máximo 3 frases. Tutea.
Lead: ${args.leadName}
Oferta: ${args.offerName}
Tipo: ${args.tipo}
Acuerdo: ${args.acuerdo}
Notas: ${args.notas}
En juego USD: ${args.enJuego || 0}
Datos de pago: ${args.paymentDetails}
JSON: {"mensaje":"..."}`,
      0.4,
      200,
      { timeoutMs: 12_000, models: ["gemini-flash-lite-latest"] },
    );
    const parsed = JSON.parse(text) as { mensaje?: string };
    return {
      mensaje: String(parsed.mensaje || "").trim() || fallback,
      recomendacion: copy.recomendacion,
      canal: "WHATSAPP" as const,
      originId,
    };
  } catch {
    return {
      mensaje: fallback,
      recomendacion: copy.recomendacion,
      canal: "WHATSAPP" as const,
      originId,
    };
  }
}

async function createFollowupAlert(
  prisma: PrismaClient,
  args: {
    userId: string;
    leadId: string;
    leadName: string;
    type: string;
    dueAt: Date;
    enJuego: number;
    contexto: string;
    acuerdo: string;
    offerName: string;
    paymentDetails: string;
    callRecordId?: string;
    intentos?: number;
    customScripts?: import("@/lib/followup-scripts").FollowupScript[];
    objecion?: string;
    fecha?: string;
  },
) {
  const open = await prisma.leadAlert.findFirst({
    where: {
      userId: args.userId,
      leadId: args.leadId,
      type: args.type,
      resolvedAt: null,
    },
  });
  const copy = await suggestedFollowupMessage({
    leadName: args.leadName,
    offerName: args.offerName,
    tipo: args.type,
    acuerdo: args.acuerdo,
    notas: args.contexto,
    enJuego: args.enJuego,
    paymentDetails: args.paymentDetails,
    intentos: args.intentos,
    customScripts: args.customScripts,
    objecion: args.objecion,
    fecha: args.fecha,
  });
  const question = followupQuestion(args.type, args.leadName, args.enJuego);
  const contexto = [copy.recomendacion, args.contexto].filter(Boolean).join("\n");
  const data = {
    type: args.type,
    question,
    dueAt: args.dueAt,
    enJuego: args.enJuego,
    canal: copy.canal,
    mensajeSugerido: copy.mensaje,
    contexto,
    callRecordId: args.callRecordId || "",
    resolvedAt: null as Date | null,
    intentos: args.intentos || 0,
    libraryScriptId: copy.originId || "",
  };
  if (open) {
    return prisma.leadAlert.update({ where: { id: open.id }, data });
  }
  return prisma.leadAlert.create({
    data: {
      userId: args.userId,
      leadId: args.leadId,
      ...data,
    },
  });
}

export async function upsertCommission(
  prisma: PrismaClient,
  args: {
    userId: string;
    leadId: string;
    callRecordId: string;
    fecha: Date;
    oferta: string;
    venta: number;
    cash: number;
    modoPago?: string | null;
    rule: ReturnType<typeof parseCommercial>["commission"];
  },
) {
  if (args.cash <= 0) return null;
  const rule = args.rule || {
    notes: "",
    tiers: [],
    pctBase: 0.03,
    umbralAcumuladoUsd: 70_000,
    pctSobreUmbral: 0.05,
    base: "cash_collected" as const,
    periodoAcumulacion: "mensual" as const,
  };
  const from = periodStart(rule.periodoAcumulacion, args.fecha);
  const prev = await prisma.commission.aggregate({
    where: {
      userId: args.userId,
      fecha: { gte: from, lt: args.fecha },
    },
    _sum: { cash: true, venta: true },
  });
  const accumulated =
    rule.base === "venta_total" ? prev._sum.venta || 0 : prev._sum.cash || 0;
  const slice =
    rule.base === "venta_total" ? args.venta : args.cash;
    const { pct, generada } = commissionOnAmount({
    rule,
    accumulatedBefore: accumulated,
    amount: slice,
    modoPago: args.modoPago,
  });
  const existing = await prisma.commission.findFirst({
    where: { userId: args.userId, callRecordId: args.callRecordId },
  });
  const payload = {
    leadId: args.leadId,
    fecha: args.fecha,
    oferta: args.oferta,
    venta: args.venta,
    cash: args.cash,
    pctAplicado: pct,
    generada,
    estado: "PENDIENTE",
  };
  if (existing) {
    return prisma.commission.update({ where: { id: existing.id }, data: payload });
  }
  return prisma.commission.create({
    data: { userId: args.userId, callRecordId: args.callRecordId, ...payload },
  });
}

/** Noon UTC on the Bogotá day, so a follow-up does not inherit the call's UTC clock. */
function followupInstant(from: Date, extraDays: number) {
  const key = zonedDayKey(from);
  const [year, month, day] = key.split("-").map(Number);
  const noon = new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1, 12, 0, 0));
  return addDays(noon, extraDays);
}

async function stampLeadOnCall(
  prisma: PrismaClient,
  userId: string,
  callRecordId: string,
  leadId: string,
) {
  const row = await prisma.callRecord.findFirst({
    where: { id: callRecordId, userId },
    select: { id: true, filingJson: true },
  });
  if (!row) return;
  const filing =
    row.filingJson && typeof row.filingJson === "object" && !Array.isArray(row.filingJson)
      ? { ...(row.filingJson as Record<string, unknown>) }
      : {};
  if (filing.lead_id === leadId) return;
  filing.lead_id = leadId;
  await prisma.callRecord.update({
    where: { id: row.id },
    data: { filingJson: filing as Prisma.InputJsonValue },
  });
}

function filingProducto(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return String((value as { producto?: unknown }).producto || "").trim();
}

export async function applyExtractorToCrm(
  prisma: PrismaClient,
  userId: string,
  callRecordId: string,
  parsed: ExtractorJson,
  offers: OfferForCrm[],
  followupOnly = false,
) {
  const readyCrm = userHasReadyCrm(offers);
  const prefs = parseCrmPrefs(
    (await prisma.user.findUnique({ where: { id: userId }, select: { crmPrefs: true } }))
      ?.crmPrefs,
  );
  const offerRefs: OfferRef[] = offers.map((offer) => ({
    productName: offer.productName,
    aliases: offer.commercial?.aliases,
  }));
  const row = await prisma.callRecord.findFirst({
    where: { id: callRecordId, userId },
  });
  if (!row) return null;

  const callAt = row.recordedAt || new Date();
  const moneyOk = readyCrm;
  const venta = moneyOk ? parsed.venta_total : null;
  const cash = moneyOk ? parsed.cash_collected : null;
  const saldo = moneyOk ? parsed.saldo_pendiente : null;

  let leadId: string | null = null;
  const catalogOpen = offersCatalogOpen(offerRefs);
  const acceptedOffer = catalogOpen ? applyProductoGuard(parsed, offerRefs).producto : "";
  if (!catalogOpen) parsed.producto = null;
  const previousProducto = filingProducto(row.filingJson);
  if (!acceptedOffer && previousProducto) parsed.producto = previousProducto;
  let offerName = acceptedOffer;
  let matched = acceptedOffer ? offers.find((offer) => offer.productName === acceptedOffer) || null : null;
  if (parsed.cliente_real && !isNonSalesCall(parsed.estado_agenda)) {
    const leads = await prisma.lead.findMany({ where: { userId } });
    const existing = findMatchingLead(leads, parsed.cliente_real);
    offerName = keptOfferName(acceptedOffer, existing?.offerName, offerRefs);
    matched = acceptedOffer ? offers.find((offer) => offer.productName === acceptedOffer) || null : null;
    const status = leadStatusFromAgenda(parsed.estado_agenda);
    const nextAt =
      parseFollowupDate(parsed.proximo_seguimiento, callAt) ||
      (parsed.requiere_seguimiento ? followupInstant(callAt, prefs.followupGraceDays) : null);
    const data = {
      company: existing?.company || "",
      offerName,
      status,
      lastSummary: parsed.notas_crm || existing?.lastSummary || "",
      nextStep: parsed.acuerdo_seguimiento || existing?.nextStep || "",
      nextStepAt: nextAt,
      objections: parsed.razon_no_cierre || existing?.objections || "",
      amountTalked: venta != null ? String(venta) : existing?.amountTalked || "",
      amountPaid: cash != null ? String(cash) : existing?.amountPaid || "",
      telefono: parsed.telefono || existing?.telefono || "",
      email: parsed.email || existing?.email || "",
      canalContacto: parsed.canal_contacto || existing?.canalContacto || "",
      calificado: parsed.calificado,
      razonNoCierre: parsed.razon_no_cierre || existing?.razonNoCierre || "",
      etapaPerdida: parsed.etapa_perdida || existing?.etapaPerdida || "",
    };
    const lead = existing
      ? await prisma.lead.update({ where: { id: existing.id }, data })
      : await prisma.lead.create({
          data: { userId, name: parsed.cliente_real, ...data },
        });
    leadId = lead.id;
    (parsed as ExtractorJson & { lead_id?: string }).lead_id = lead.id;
    if (existing) {
      if (parsed.requiere_seguimiento === false) {
        await resolveOpenAlertsForLead(prisma, userId, lead.id);
      }
    }

    if (parsed.requiere_seguimiento === false) {
      await resolveOpenAlertsForLead(prisma, userId, lead.id);
    } else if (moneyOk || parsed.estado_agenda === "NO SHOW" || parsed.estado_agenda === "REPROGRAMA") {
      await spawnAlertsFromExtractor(prisma, {
        userId,
        leadId: lead.id,
        leadName: parsed.cliente_real,
        parsed,
        offer: matched,
        offerName,
        callAt,
        callRecordId,
        prefs,
        readyCrm: moneyOk,
      });
    }

    if (followupOnly) {
      await stampLeadOnCall(prisma, userId, callRecordId, lead.id);
      return { callRecordId, leadId, parsed, summary: extractorOneLiner(parsed) };
    }

    if (moneyOk && cash && cash > 0) {
      await upsertCommission(prisma, {
        userId,
        leadId: lead.id,
        callRecordId,
        fecha: callAt,
        oferta: offerName,
        venta: venta || 0,
        cash,
        modoPago: parsed.modo_pago,
        rule: matched?.commercial.commission || null,
      });
    }
    const { fulfillAgendado } = await import("@/lib/agenda");
    await fulfillAgendado(prisma, userId, {
      leadName: parsed.cliente_real,
      recordedAt: callAt,
      estado: parsed.estado_agenda,
    });
  }

  if (followupOnly) {
    return { callRecordId, leadId, parsed, summary: extractorOneLiner(parsed) };
  }

  const summary = extractorOneLiner(parsed);
  await prisma.callRecord.update({
    where: { id: callRecordId },
    data: {
      callType: parsed.estado_agenda || row.callType,
      result:
        isNonSalesCall(parsed.estado_agenda)
          ? ""
          : parsed.estado_agenda === "CIERRE VENTA"
            ? "cerro"
            : parsed.estado_agenda === "NO SHOW"
              ? "no_cerro"
              : parsed.estado_agenda === "ACUERDO SIN PAGO"
                ? "pendiente"
                : "pendiente",
      leadName: parsed.cliente_real || row.leadName,
      offerName: keptOfferName(acceptedOffer, row.offerName, offerRefs),
      trainsBot: trainsBot(parsed.estado_agenda),
      summary,
      filingStatus: "confirmed",
      filingJson: parsed as unknown as Prisma.InputJsonValue,
      confirmedAt: new Date(),
      estadoAgenda: parsed.estado_agenda || "",
      ventaTotal: venta,
      cashCollected: cash,
      saldoPendiente: saldo,
      modoPago: parsed.modo_pago || "",
    },
  });

  return { callRecordId, leadId, parsed, summary };
}

async function spawnAlertsFromExtractor(
  prisma: PrismaClient,
  args: {
    userId: string;
    leadId: string;
    leadName: string;
    parsed: ExtractorJson;
    offer: OfferForCrm | null;
    offerName: string;
    callAt: Date;
    callRecordId: string;
    prefs: ReturnType<typeof parseCrmPrefs>;
    readyCrm: boolean;
  },
) {
  const { parsed, prefs } = args;
  const paymentDetails = args.offer?.commercial.paymentDetails || "";
  const customScripts = args.offer?.commercial.scripts || [];
  const fechaPago = parseFollowupDate(parsed.proximo_seguimiento, args.callAt);
  const objecion = parsed.razon_no_cierre || "";
  const saldo = parsed.saldo_pendiente || 0;
  const hasSaldo = args.readyCrm && (saldo > 0 || parsed.estado_agenda === "ACUERDO SIN PAGO");
  const pagoAt = hasSaldo
    ? fechaPago ||
      addDays(
        args.callAt,
        parsed.estado_agenda === "ACUERDO SIN PAGO"
          ? 1
          : deadlineDaysForPago(args.offer, parsed.modo_pago) || prefs.followupGraceDays,
      )
    : null;

  const opened = await openFollowupThread(prisma, {
    userId: args.userId,
    leadId: args.leadId,
    leadName: args.leadName,
    offerId: args.offer?.id || "",
    offerName: args.offerName,
    parsed,
    callAt: args.callAt,
    callRecordId: args.callRecordId,
    pagoAt,
    meetingAt:
      parsed.estado_agenda === "REPROGRAMA" ||
      parsed.tipo_seguimiento?.toUpperCase().includes("SEGUNDA")
        ? fechaPago
        : null,
    enJuego: saldo || parsed.venta_total || 0,
    paymentDetails,
    customScripts,
    objecion,
  });
  if (!opened && parsed.requiere_seguimiento === false) {
    await resolveOpenAlertsForLead(prisma, args.userId, args.leadId);
  }
}

export function fillExtractorField(
  current: ExtractorJson,
  field: string,
  value: string,
): ExtractorJson {
  const next = { ...current, evidencia: { ...current.evidencia }, confianza: { ...current.confianza } };
  const text = value.trim();
  const n = Number(text.replace(/[^\d.-]/g, ""));
  if (field === "cliente_real") next.cliente_real = text;
  if (field === "estado_agenda") next.estado_agenda = normalizeEstadoAgenda(text);
  if (field === "producto") {
    next.producto = text;
    next.confianza.producto = 95;
  }
  if (field === "venta_total" && Number.isFinite(n)) next.venta_total = n;
  if (field === "cash_collected" && Number.isFinite(n)) next.cash_collected = n;
  if (field === "modo_pago") next.modo_pago = text;
  if (field === "tipo_seguimiento") next.tipo_seguimiento = canonicalTipo(text) || null;
  if (field === "proximo_seguimiento") {
    next.proximo_seguimiento = inferFollowupDate(text, new Date()) || text;
    next.confianza.proximo_seguimiento = 95;
  }
  if (field === "requiere_seguimiento") {
    next.requiere_seguimiento = /si|true|sí|yes/i.test(text)
      ? true
      : /no|false/i.test(text)
        ? false
        : null;
  }
  if (field === "razon_no_cierre") next.razon_no_cierre = text;
  if (field === "revision") {
    next.requiere_revision_humana = false;
    next.motivo_revision = null;
    if (/no show/i.test(text)) next.estado_agenda = "NO SHOW";
    else if (/reprog/i.test(text)) next.estado_agenda = "REPROGRAMA";
    else if (/cerr/i.test(text) || /pag/i.test(text)) next.estado_agenda = "CIERRE VENTA";
    else if (/acuerdo/i.test(text)) next.estado_agenda = "ACUERDO SIN PAGO";
    else if (/show/i.test(text)) next.estado_agenda = "SHOW";
  }
  next.confianza = {
    ...next.confianza,
    cliente_real: next.cliente_real ? 95 : next.confianza.cliente_real,
    estado_agenda: next.estado_agenda ? 95 : next.confianza.estado_agenda,
    venta_total: next.venta_total != null ? 95 : next.confianza.venta_total,
    cash_collected: next.cash_collected != null ? 95 : next.confianza.cash_collected,
    requiere_seguimiento:
      next.requiere_seguimiento != null ? 95 : next.confianza.requiere_seguimiento,
    tipo_seguimiento: next.tipo_seguimiento ? 95 : next.confianza.tipo_seguimiento,
    proximo_seguimiento: next.proximo_seguimiento ? 95 : next.confianza.proximo_seguimiento,
  };
  next.requiere_revision_humana = false;
  return next;
}

export async function confirmExtractorFiling(
  prisma: PrismaClient,
  userId: string,
  callRecordId: string,
  patch?: Partial<ExtractorJson> | { field?: string; value?: string },
) {
  const row = await prisma.callRecord.findFirst({
    where: { id: callRecordId, userId },
  });
  if (!row) return null;
  let parsed = isExtractorJson(row.filingJson)
    ? parseExtractorJson(row.filingJson)
    : parseExtractorJson({
        cliente_real: row.leadName,
        estado_agenda: row.estadoAgenda || "SHOW",
        producto: row.offerName,
        notas_crm: row.summary,
      });
  const before = parsed;
  if (patch && "field" in patch && patch.field && patch.value != null) {
    parsed = fillExtractorField(parsed, patch.field, String(patch.value));
    const field = patch.field;
    let previous =
      field in before ? String((before as Record<string, unknown>)[field] ?? "") : "";
    const next =
      field in parsed ? String((parsed as Record<string, unknown>)[field] ?? "") : String(patch.value);
    if (field === "producto") {
      const amount = before.venta_total ?? before.cash_collected ?? before.saldo_pendiente;
      if (amount != null && amount > 0) previous = `MONTO:${Math.round(amount)}`;
    }
    await recordExtractorFeedback(prisma, {
      userId,
      callRecordId: row.id,
      campo: field,
      valorExtraido: previous,
      valorCorregido: next,
      title: row.title,
    });
  } else if (patch) {
    parsed = parseExtractorJson({ ...parsed, ...patch });
    parsed.requiere_revision_humana = false;
  }
  const offers = await loadOffersForCrm(prisma, userId);
  const readyCrm = userHasReadyCrm(offers);
  const gap = extractorGap(parsed, readyCrm, offers);
  await prisma.callRecord.update({
    where: { id: row.id },
    data: { filingJson: parsed as unknown as Prisma.InputJsonValue },
  });
  if (gap) {
    return { gap, parsed, applied: false as const, callRecordId };
  }
  const applied = await applyExtractorToCrm(prisma, userId, row.id, parsed, offers);
  return { gap: null, parsed, applied: true as const, callRecordId, summary: applied?.summary };
}

function storedFiling(raw: unknown): ExtractorJson {
  const parsed = parseExtractorJson(raw);
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text = (key: string) => {
    const value = String(row[key] ?? "").trim();
    if (!value || value.toLowerCase() === "null") return null;
    return value;
  };
  const cliente = text("cliente_real");
  if (cliente) parsed.cliente_real = cliente;
  const proximo = text("proximo_seguimiento");
  if (proximo) parsed.proximo_seguimiento = proximo;
  if (row.requiere_seguimiento === true) parsed.requiere_seguimiento = true;
  const venta = Number(row.venta_total);
  if (Number.isFinite(venta) && venta > 1_000_000) parsed.venta_total = null;
  else if (Number.isFinite(venta) && venta >= 0) parsed.venta_total = venta;
  const saldo = Number(row.saldo_pendiente);
  if (Number.isFinite(saldo) && saldo > 1_000_000) parsed.saldo_pendiente = null;
  const modo = text("modo_pago");
  if (modo && modo.replace(/\D/g, "").length > 7) parsed.modo_pago = null;
  else if (modo) parsed.modo_pago = modo;
  return parsed;
}

async function refillFromTranscript(
  prisma: PrismaClient,
  userId: string,
  call: { id: string; sourceId: string; title: string; recordedAt: Date | null },
  parsed: ExtractorJson,
) {
  const missingMoney =
    parsed.venta_total == null ||
    parsed.venta_total > 1_000_000 ||
    !parsed.modo_pago;
  const missingClock = Boolean(parsed.proximo_seguimiento) && !/\d{2}:\d{2}/.test(parsed.proximo_seguimiento || "");
  const pasted = isPasteHeading(call.title);
  if (!call.sourceId || (!missingMoney && !missingClock && !pasted)) return;
  const transcript = await prisma.clientTranscript.findFirst({
    where: { id: call.sourceId, userId },
    select: { transcriptText: true },
  });
  if (!transcript?.transcriptText) return;
  const callAt = (pasted ? inferCallDate(transcript.transcriptText) : null) || call.recordedAt;
  enrichExtractorFollowup(parsed, { transcript: transcript.transcriptText, callAt });
  await prisma.callRecord.update({
    where: { id: call.id },
    data: {
      title: pasted
        ? pastedCallTitle(transcript.transcriptText, callAt || new Date(), parsed.cliente_real || "")
        : call.title,
      recordedAt: callAt || undefined,
      leadName: parsed.cliente_real || undefined,
      ventaTotal: parsed.venta_total,
      cashCollected: parsed.cash_collected,
      saldoPendiente: parsed.saldo_pendiente,
      modoPago: parsed.modo_pago || "",
      filingJson: parsed as unknown as Prisma.InputJsonValue,
    },
  });
  if (pasted && parsed.cliente_real) {
    const transcriptRow = await prisma.clientTranscript.findFirst({
      where: { id: call.sourceId, userId },
      select: { id: true },
    });
    if (transcriptRow) {
      await prisma.clientTranscript.update({
        where: { id: transcriptRow.id },
        data: {
          title: pastedCallTitle(
            transcript.transcriptText,
            callAt || new Date(),
            parsed.cliente_real || "",
          ),
        },
      });
    }
  }
}

const FOLLOWUP_REPAIR_KEY = "followupRepairAt";
const REPAIR_INFLIGHT_MS = 60_000;
const repairInflight = new Map<string, number>();

function repairAlreadyRunning(userId: string) {
  const started = repairInflight.get(userId);
  if (started == null) return false;
  if (Date.now() - started > REPAIR_INFLIGHT_MS) {
    repairInflight.delete(userId);
    return false;
  }
  return true;
}

/** True when no confirmed call is newer than the last completed repair. */
export function followupRepairIsCurrent(
  latest: Date | string | null | undefined,
  watermark: string | null | undefined,
) {
  if (latest == null || latest === "") return true;
  const latestMs = new Date(latest).getTime();
  if (!Number.isFinite(latestMs)) return true;
  if (!watermark) return false;
  const markMs = new Date(watermark).getTime();
  if (!Number.isFinite(markMs)) return false;
  return markMs >= latestMs;
}

/**
 * Watermark check plus the filing scan. Only call this from after(), never
 * from a read that is still building the response.
 */
export async function runFollowupRepairIfStale(prisma: PrismaClient, userId: string) {
  const rows = await prisma.$queryRaw<{ latest: Date | null; watermark: string | null }[]>`
    SELECT
      (
        SELECT MAX(COALESCE("confirmedAt", "createdAt"))
        FROM "CallRecord"
        WHERE "userId" = ${userId}
          AND "filingStatus" IN ('confirmed', 'pending')
      ) AS latest,
      (
        SELECT "crmPrefs"->>'followupRepairAt'
        FROM "User"
        WHERE "id" = ${userId}
      ) AS watermark
  `;
  const latest = rows[0]?.latest ?? null;
  const watermark = rows[0]?.watermark ?? null;
  if (followupRepairIsCurrent(latest, watermark)) return;
  if (repairAlreadyRunning(userId)) return;
  const stamp = new Date(latest as Date | string).toISOString();
  repairInflight.set(userId, Date.now());
  try {
    await repairMissingFollowups(prisma, userId);
    await patchCrmPref(prisma, userId, FOLLOWUP_REPAIR_KEY, stamp);
  } catch (error) {
    console.error("repair followups", error);
  } finally {
    repairInflight.delete(userId);
  }
}

/** Registers the watermark check for after the response. Does not query. */
export function scheduleMissingFollowupRepair(prisma: PrismaClient, userId: string) {
  const start = () => {
    void runFollowupRepairIfStale(prisma, userId);
  };
  void import("next/server")
    .then(({ after }) => {
      try {
        after(start);
      } catch (error) {
        console.error("repair followups schedule", error);
      }
    })
    .catch(() => undefined);
}

/** Opens a thread for calls that already named a follow-up but never spawned one. */
export async function repairMissingFollowups(prisma: PrismaClient, userId: string) {
  const offers = await loadOffersForCrm(prisma, userId);
  const [calls, threads, leads] = await Promise.all([
    prisma.$queryRaw<
      {
        id: string;
        sourceId: string;
        title: string;
        recordedAt: Date | null;
        cliente: string | null;
        estado: string | null;
        proximo: string | null;
        requiere: string | null;
        resultado: string | null;
        extractor: boolean;
      }[]
    >`
      SELECT id,
             "sourceId",
             title,
             "recordedAt",
             "filingJson"->>'cliente_real' AS cliente,
             "filingJson"->>'estado_agenda' AS estado,
             "filingJson"->>'proximo_seguimiento' AS proximo,
             "filingJson"->>'requiere_seguimiento' AS requiere,
             "filingJson"->>'seguimiento_resultado' AS resultado,
             (
               ("filingJson"->'cliente_real') IS NOT NULL
               OR ("filingJson"->'estado_agenda') IS NOT NULL
             ) AS extractor
      FROM "CallRecord"
      WHERE "userId" = ${userId}
        AND "filingStatus" IN ('confirmed', 'pending')
      ORDER BY "recordedAt" DESC NULLS FIRST, "createdAt" DESC
      LIMIT 400
    `,
    prisma.followupThread.findMany({
      where: { userId, estado: "activo" },
      select: { leadId: true, alerts: { where: { resolvedAt: null }, select: { id: true } } },
    }),
    prisma.lead.findMany({ where: { userId } }),
  ]);
  const covered = new Set(
    threads.filter((row) => row.alerts.length > 0).map((row) => row.leadId),
  );
  const seen = new Set<string>();
  for (const call of calls) {
    try {
      if (call.extractor !== true && call.extractor !== ("true" as unknown)) continue;
      const cliente = String(call.cliente || "").trim();
      const proximo = String(call.proximo || "");
      const requiere = call.requiere === "true";
      if (followupIsClosed({ seguimiento_resultado: call.resultado, proximo_seguimiento: proximo })) continue;
      if (!cliente || isNonSalesCall(call.estado)) continue;
      if (!proximo && !requiere) continue;
      const key = cliente.toLowerCase();
      if (seen.has(key)) continue;
      const lead = findMatchingLead(leads, cliente);
      if (lead && covered.has(lead.id)) {
        seen.add(key);
        continue;
      }
      const full = await prisma.callRecord.findFirst({
        where: { id: call.id, userId },
        select: { id: true, sourceId: true, title: true, recordedAt: true, filingJson: true },
      });
      if (!full || !isExtractorJson(full.filingJson)) continue;
      const parsed = storedFiling(full.filingJson);
      await refillFromTranscript(prisma, userId, full, parsed);
      const opened = await applyExtractorToCrm(prisma, userId, full.id, parsed, offers, true);
      if (opened?.leadId) covered.add(opened.leadId);
      seen.add(key);
    } catch (error) {
      console.error("repair followup", call.id, error);
    }
  }
}

export { extractorGap, extractorOneLiner, isExtractorJson, parseExtractorJson };
