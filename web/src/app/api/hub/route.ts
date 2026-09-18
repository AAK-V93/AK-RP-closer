import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateGeminiJson } from "@/lib/gemini";
import { HUB_SYSTEM_PROMPT } from "@/lib/hub-prompt";
import { getWorkspace, getWorkspacePrisma } from "@/lib/workspace";
import { ensureCrmTables } from "@/lib/prisma";
import { applyCrmChatUpdate, type CrmChatPatch } from "@/lib/file-call";
import {
  confirmCallFiling,
  listPendingFilings,
  skipCallFiling,
  type CallFiling,
} from "@/lib/call-intelligence";
import { applyAlertOutcome, resolveAlert, snoozeAlert, type AlertOutcome } from "@/lib/alerts";
import { applyAgendaCheck, upsertLeadForAgenda } from "@/lib/agenda";
import { chooseFollowupOption } from "@/lib/followup-library";
import { persistCommissionRule } from "@/lib/commission";
import { normalizeWhatsApp } from "@/lib/whatsapp";
import {
  THREAD_HUB,
  appendThreadLines,
  loadThread,
} from "@/lib/chat-threads";
import { crmDashboard } from "@/lib/crm-metrics";
import { loadCommissionProjection, projectCommission } from "@/lib/crm-projection";
import {
  applyCommercialAnswer,
  looksLikeOfferBlob,
  parseCommercial,
  type ExtractedOffer,
} from "@/lib/offer-commercial";
import { isOfferExtractConfirm, offerBatchRecap } from "@/lib/offer-extract";
import {
  clearPendingOfferExtract,
  persistExtractedOffers,
  readPendingOfferExtract,
  revisePendingOfferExtract,
  stageOfferBlob,
} from "@/lib/offer-ingest";
import { getHomeState } from "@/lib/home-state";
import { parseCrmPrefs, parseMonthlyGoalUsd, saveMonthlyGoal } from "@/lib/crm-prefs";
import { applyHubUtterance, parseHubUtterance } from "@/lib/hub-utterance";
import { vapidPublicKey } from "@/lib/web-push";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
    }
    const prisma = await getWorkspacePrisma();
    if (!prisma) return NextResponse.json({ error: "DB" }, { status: 503 });
    try {
      await ensureCrmTables(prisma);
    } catch (error) {
      console.error("hub GET ensureCrm", error);
    }

    let messages: Awaited<ReturnType<typeof loadThread>>["messages"] = [];
    try {
      const loaded = await loadThread(prisma, session.user.id, THREAD_HUB);
      messages = loaded.messages;
    } catch (error) {
      console.error("hub GET thread", error);
    }

    const snapshot = await hubSnapshot(prisma, session.user.id);
    return NextResponse.json({ messages, snapshot });
  } catch (error) {
    console.error("hub GET", error);
    return NextResponse.json(
      {
        error: "No se pudo cargar el inicio",
        messages: [],
        snapshot: {
          home: {
            phase: "a",
            hasOffer: false,
            hasRealCalls: false,
            fathomConnected: false,
            autoIngest: false,
            fathomCount: 0,
            uploadCount: 0,
            canPractice: false,
            showCrm: false,
            missingCrm: null,
            lastUnanalyzed: null,
          },
          pendingCalls: [],
          alertsDue: [],
          monthlyGoalUsd: null,
          needsMonthlyGoal: false,
          projection: null,
          pendingOfferExtract: null,
          needsPushPrompt: false,
        },
      },
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
    }
    const prisma = await getWorkspacePrisma();
    if (!prisma) return NextResponse.json({ error: "DB" }, { status: 503 });
    await ensureCrmTables(prisma);

    const body = (await request.json()) as {
      message?: string;
      start?: boolean;
      confirmCallId?: string;
      skipCallId?: string;
      fillCall?: { id: string; field?: string; value: string };
      correctCall?: { id: string } & Partial<CallFiling>;
      resolveAlertId?: string;
      snoozeAlertId?: string;
      alertOutcome?: {
        id: string;
        resultado: AlertOutcome;
        amount?: number;
        nota?: string;
        razonNoCierre?: string;
      };
      pickScript?: { id: string; optionId: string };
      agendaOutcome?: { id: string; estado: "SHOW" | "NO SHOW" | "REPROGRAMA" };
      monthlyGoalUsd?: number;
      confirmOffers?: ExtractedOffer[];
    };

    const userId = session.user.id;
    const canned: string[] = [];

    if (body.confirmCallId) {
      const done = await confirmCallFiling(prisma, userId, body.confirmCallId);
      canned.push(
        done && "summary" in done && done.summary
          ? done.summary
          : done && "gap" in done && done.gap
            ? done.gap.question
            : "OK.",
      );
    }
    if (body.fillCall?.id) {
      const done = await confirmCallFiling(prisma, userId, body.fillCall.id, {
        field: body.fillCall.field || "",
        value: body.fillCall.value,
      });
      canned.push(
        done && "applied" in done && done.applied && done.summary
          ? done.summary
          : done && "gap" in done && done.gap
            ? done.gap.question
            : "Anotado.",
      );
    }
    if (body.correctCall?.id) {
      const { id, ...patch } = body.correctCall;
      const done = await confirmCallFiling(prisma, userId, id, patch);
      canned.push(
        done && "applied" in done && done.applied && done.parsed.cliente_real
          ? `Corregido. ${done.parsed.cliente_real} quedó como dijiste.`
          : done && "gap" in done && done.gap
            ? done.gap.question
            : "Corregí esa llamada.",
      );
    }
    if (body.skipCallId) {
      await skipCallFiling(prisma, userId, body.skipCallId);
      canned.push("Listo, no la metí al CRM.");
    }
    if (body.resolveAlertId) {
      await resolveAlert(prisma, userId, body.resolveAlertId);
      canned.push("Alerta resuelta.");
    }
    if (body.snoozeAlertId) {
      await snoozeAlert(prisma, userId, body.snoozeAlertId, 1);
      canned.push("La pospuse para mañana.");
    }

    if (body.pickScript?.id && body.pickScript.optionId) {
      const out = await chooseFollowupOption(
        prisma,
        userId,
        body.pickScript.id,
        body.pickScript.optionId,
      );
      canned.push("error" in out ? "No pude dejar ese guion." : "Dejé ese mensaje.");
    }

    if (body.alertOutcome?.id) {
      const out = await applyAlertOutcome(prisma, userId, body.alertOutcome.id, {
        resultado: body.alertOutcome.resultado,
        amount: body.alertOutcome.amount,
        nota: body.alertOutcome.nota,
        razonNoCierre: body.alertOutcome.razonNoCierre,
      });
      canned.push(
        "askLost" in out && out.askLost
          ? "Tercer intento. ¿Lo marco perdido?"
          : "lost" in out && out.lost
            ? "Lo marqué perdido."
            : "Anotado.",
      );
    }

    if (body.agendaOutcome?.id && body.agendaOutcome.estado) {
      const out = await applyAgendaCheck(
        prisma,
        userId,
        body.agendaOutcome.id,
        body.agendaOutcome.estado,
      );
      canned.push("error" in out ? "No encontré esa agenda." : `Anoté ${body.agendaOutcome.estado}.`);
    }

    if (typeof body.monthlyGoalUsd === "number" && body.monthlyGoalUsd > 0) {
      const saved = await saveMonthlyGoal(prisma, userId, body.monthlyGoalUsd);
      canned.push(
        saved
          ? `Guardé tu meta: USD ${saved.toLocaleString("es")} este mes.`
          : "No pude guardar esa meta.",
      );
    }

    if (Array.isArray(body.confirmOffers) && body.confirmOffers.length) {
      try {
        const saved = await persistExtractedOffers(
          prisma,
          userId,
          body.confirmOffers,
        );
        await clearPendingOfferExtract(prisma, userId);
        const names = saved.names.join(", ");
        canned.push(
          saved.nextQ
            ? `Guardé ${names}. ${saved.nextQ.question}`
            : `Guardé ${names}.`,
        );
      } catch (error) {
        console.error("hub confirmOffers", error);
        canned.push("No pude guardar esas ofertas.");
      }
    }

    const structuredOnly =
      Boolean(
        body.confirmCallId ||
          body.skipCallId ||
          body.fillCall?.id ||
          body.correctCall?.id ||
          body.resolveAlertId ||
          body.snoozeAlertId ||
          body.alertOutcome?.id ||
          body.agendaOutcome?.id ||
          body.pickScript?.id ||
          typeof body.monthlyGoalUsd === "number" ||
          (Array.isArray(body.confirmOffers) && body.confirmOffers.length > 0),
      ) && !body.message && !body.start;

    const snapshot = await hubSnapshot(prisma, userId);
    const userText = body.start
      ? ""
      : String(body.message || "").trim();

    if (structuredOnly) {
      const snapshotAfter = await hubSnapshot(prisma, userId);
      const extra =
        snapshotAfter.needsMonthlyGoal && body.confirmOffers?.length
          ? " ¿Cuánto quieres ganar de comisión este mes?"
          : "";
      const reply = (canned.join(" ") || "Listo.") + extra;
      const coachLine = await appendHubLines(prisma, userId, null, reply);
      return NextResponse.json({
        message: coachLine,
        actions: nextHubActions(snapshotAfter),
        snapshot: snapshotAfter,
      });
    }

    if (body.start || !userText) {
      const fresh = snapshot;
      const greeting =
        fresh.home?.phase === "c"
          ? "¿Qué pasó hoy o qué quieres hacer?"
          : "Cuando quieras, dime qué pasó. Primero completa el paso de arriba.";
      if (body.start) {
        return NextResponse.json({
          message: {
            id: "start",
            role: "coach",
            content: greeting,
            createdAt: new Date().toISOString(),
          },
          actions: nextHubActions(fresh),
          snapshot: fresh,
        });
      }
      return NextResponse.json({ error: "Escribe algo" }, { status: 400 });
    }

    const live = await hubSnapshot(prisma, userId);
    const prefsRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { crmPrefs: true },
    });
    const pendingExtract = readPendingOfferExtract(prefsRow?.crmPrefs);
    const offerFeedback =
      isOfferExtractConfirm(userText) ||
      looksLikeOfferBlob(userText) ||
      /\b(nombre|oferta|programa|una sola|varias|es una|son dos|se llama|el primero|el segundo)\b/i.test(
        userText,
      );
    if (pendingExtract && !body.start && offerFeedback) {
      const restage =
        looksLikeOfferBlob(userText) &&
        userText.length >= 120 &&
        !isOfferExtractConfirm(userText);
      if (restage) {
        try {
          const staged = await stageOfferBlob(
            prisma,
            userId,
            userText,
            pendingExtract.targetOfferId || live.missingCrm?.offerId || undefined,
          );
          const coachLine = await appendHubLines(
            prisma,
            userId,
            userText,
            `${staged.recap}\nConfirma cada bloque arriba: Sí o Corregir. La comisión no la asumo.`,
          );
          const fresh = await hubSnapshot(prisma, userId);
          return NextResponse.json({
            message: coachLine,
            actions: nextHubActions(fresh),
            snapshot: fresh,
          });
        } catch (error) {
          console.error("offer restage", error);
        }
      }
      try {
        if (isOfferExtractConfirm(userText)) {
          const coachLine = await appendHubLines(
            prisma,
            userId,
            userText,
            "Confirma cada bloque arriba (Sí o Corregir). La comisión no la asumo.",
          );
          const fresh = await hubSnapshot(prisma, userId);
          return NextResponse.json({
            message: coachLine,
            actions: nextHubActions(fresh),
            snapshot: fresh,
          });
        }
        const revised = await revisePendingOfferExtract(prisma, userId, userText);
        if (revised) {
          const coachLine = await appendHubLines(
            prisma,
            userId,
            userText,
            `${offerBatchRecap(revised)}\nConfirma cada bloque arriba: Sí o Corregir.`,
          );
          const fresh = await hubSnapshot(prisma, userId);
          return NextResponse.json({
            message: coachLine,
            actions: nextHubActions(fresh),
            snapshot: fresh,
          });
        }
      } catch (error) {
        console.error("offer confirm", error);
        const coachLine = await appendHubLines(
          prisma,
          userId,
          userText,
          "No pude ajustar eso. Usa Sí o Corregir en cada bloque de arriba.",
        );
        const fresh = await hubSnapshot(prisma, userId);
        return NextResponse.json({
          message: coachLine,
          actions: nextHubActions(fresh),
          snapshot: fresh,
        });
      }
    }
    const spoken = parseHubUtterance(userText);
    if (spoken && !body.start) {
      const out = await applyHubUtterance(prisma, userId, spoken);
      const coachLine = await appendHubLines(prisma, userId, userText, out.reply);
      const fresh = await hubSnapshot(prisma, userId);
      return NextResponse.json({
        message: coachLine,
        actions: nextHubActions(fresh),
        snapshot: fresh,
      });
    }
    if (live.pendingCalls[0] && !body.start) {
      const pending = live.pendingCalls[0];
      const done = await confirmCallFiling(prisma, userId, pending.id, {
        field: pending.field || "revision",
        value: userText,
      });
      const reply =
        done && "applied" in done && done.applied && done.summary
          ? done.summary
          : done && "gap" in done && done.gap
            ? done.gap.question
            : "Anotado.";
      const coachLine = await appendHubLines(prisma, userId, userText, reply);
      const fresh = await hubSnapshot(prisma, userId);
      return NextResponse.json({
        message: coachLine,
        actions: nextHubActions(fresh),
        snapshot: fresh,
      });
    }
    const agendaDue = live.alertsDue.find((row) => row.tipo === "AGENDA_CHECK");
    if (agendaDue && !body.start) {
      const lower = userText.toLowerCase();
      const estado = /no show/.test(lower)
        ? "NO SHOW"
        : /reprog/.test(lower)
          ? "REPROGRAMA"
          : /show|se hizo|sin grab/.test(lower)
            ? "SHOW"
            : null;
      if (estado) {
        await applyAgendaCheck(prisma, userId, agendaDue.id, estado);
        const coachLine = await appendHubLines(
          prisma,
          userId,
          userText,
          `Anoté ${estado}.`,
        );
        const fresh = await hubSnapshot(prisma, userId);
        return NextResponse.json({
          message: coachLine,
          actions: nextHubActions(fresh),
          snapshot: fresh,
        });
      }
    }
    const waMatch = userText.match(
      /(?:whats?app|mi n[uú]mero)[^\d+]{0,20}(\+?\d[\d\s-]{7,})/i,
    );
    if (waMatch && !body.start) {
      const phone = normalizeWhatsApp(waMatch[1]);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { crmPrefs: true },
      });
      const prefs = {
        ...((user?.crmPrefs || {}) as Record<string, unknown>),
        whatsappE164: phone,
      };
      await prisma.user.update({
        where: { id: userId },
        data: { crmPrefs: prefs as Prisma.InputJsonValue },
      });
      const coachLine = await appendHubLines(
        prisma,
        userId,
        userText,
        `Guardé tu WhatsApp ${phone}. El digest diario llega ahí si Twilio está configurado.`,
      );
      const fresh = await hubSnapshot(prisma, userId);
      return NextResponse.json({
        message: coachLine,
        actions: nextHubActions(fresh),
        snapshot: fresh,
      });
    }
    const goalFromChat = parseMonthlyGoalUsd(userText);
    const wantsGoalChange =
      /meta|ganar.{0,24}comisi|comisi[oó]n este mes|quiero ganar/i.test(userText);
    if (
      goalFromChat &&
      (live.needsMonthlyGoal || wantsGoalChange) &&
      !live.pendingCalls[0] &&
      !pendingExtract
    ) {
      const saved = await saveMonthlyGoal(prisma, userId, goalFromChat);
      const until = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
      const proj = await projectCommission(prisma, userId, {
        metaUsd: saved || goalFromChat,
        until,
      });
      const coachLine = await appendHubLines(
        prisma,
        userId,
        userText,
        `Guardé tu meta: USD ${(saved || goalFromChat).toLocaleString("es")} este mes.\n${proj.reply}`,
      );
      const fresh = await hubSnapshot(prisma, userId);
      return NextResponse.json({
        message: coachLine,
        actions: nextHubActions(fresh),
        snapshot: fresh,
      });
    }
    if (live.missingCrm && !body.start) {
      if (!looksLikeOfferBlob(userText)) {
        const coachLine = await appendHubLines(
          prisma,
          userId,
          userText,
          "Pega todo junto: qué vendes, precios, cómo paga el lead y cómo te pagan comisión (puede depender del plazo o la forma de pago). O súbelo en Ofertas. No hace falta ir dato por dato.",
        );
        const fresh = await hubSnapshot(prisma, userId);
        return NextResponse.json({
          message: coachLine,
          actions: nextHubActions(fresh),
          snapshot: fresh,
        });
      }
      let staged;
      try {
        staged = await stageOfferBlob(
          prisma,
          userId,
          userText,
          live.missingCrm.offerId || undefined,
        );
      } catch (error) {
        console.error("offer blob", error);
        const coachLine = await appendHubLines(
          prisma,
          userId,
          userText,
          "No pude extraer eso. Pega más detalle o súbelo en Ofertas (PDF o un texto con precios, pagos y comisión).",
        );
        const fresh = await hubSnapshot(prisma, userId);
        return NextResponse.json({
          message: coachLine,
          actions: nextHubActions(fresh),
          snapshot: fresh,
        });
      }
      const coachLine = await appendHubLines(
        prisma,
        userId,
        userText,
        `${staged.recap}\nConfirma cada bloque arriba: Sí o Corregir. La comisión no la asumo.`,
      );
      const fresh = await hubSnapshot(prisma, userId);
      return NextResponse.json({
        message: coachLine,
        actions: nextHubActions(fresh),
        snapshot: fresh,
      });
    }

    const existingThread = await loadThread(prisma, userId, THREAD_HUB);
    const recent = existingThread.messages
      .slice(-8)
      .map((line) => `${line.role}: ${line.content}`)
      .join("\n");

    const prompt = `${HUB_SYSTEM_PROMPT}

# ESTADO
${JSON.stringify(snapshot)}

# RECIENTE
${recent || "(sin historial)"}

# MENSAJE
${userText}`;

    let parsed: {
      reply?: string;
      actions?: { type?: string; href?: string; label?: string }[];
      crm?: (CrmChatPatch & { agendaAt?: string }) | null;
      offerPatch?: { offerId?: string; field?: string; value?: string } | null;
      projection?: { metaUsd?: number; until?: string; closeRate?: number } | null;
      commissionPaid?: { name?: string; amount?: number } | null;
    } = {};
    try {
      const raw = await generateGeminiJson(prompt, 0.3, 1024, {
        timeoutMs: 40_000,
        models: ["gemini-flash-latest", "gemini-flash-lite-latest"],
      });
      const cleaned = raw
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/```$/u, "")
        .trim();
      parsed = JSON.parse(cleaned) as typeof parsed;
    } catch (error) {
      console.error("hub gemini", error);
      const coachLine = await appendHubLines(
        prisma,
        userId,
        userText,
        canned.join(" ") || "No pude armar la respuesta. Prueba otra vez en un momento.",
      );
      const fresh = await hubSnapshot(prisma, userId);
      return NextResponse.json({
        message: coachLine,
        actions: nextHubActions(fresh),
        snapshot: fresh,
      });
    }
    if (parsed.offerPatch?.field && parsed.offerPatch.value) {
      if (
        parsed.offerPatch.field === "oferta_doc" ||
        looksLikeOfferBlob(parsed.offerPatch.value)
      ) {
        try {
          const staged = await stageOfferBlob(
            prisma,
            userId,
            parsed.offerPatch.value,
            parsed.offerPatch.offerId || undefined,
          );
          parsed.reply = `${staged.recap}\nConfirma cada bloque arriba: Sí o Corregir. La comisión no la asumo.`;
        } catch (error) {
          console.error("offerPatch blob", error);
        }
      } else {
        const offers = await prisma.userOffer.findMany({ where: { userId } });
        const target =
          offers.find((row) => row.id === parsed.offerPatch?.offerId) || offers[0];
        if (target) {
          const commercial = applyCommercialAnswer(
            parseCommercial(target.commercial),
            parsed.offerPatch.field,
            parsed.offerPatch.value,
          );
          await prisma.userOffer.update({
            where: { id: target.id },
            data: { commercial: commercial as unknown as Prisma.InputJsonValue },
          });
          if (commercial.commission) {
            await persistCommissionRule(prisma, userId, target.id, commercial.commission);
          }
        }
      }
    }
    if (parsed.commissionPaid?.name) {
      const amount = Number(parsed.commissionPaid.amount || 0);
      const lead = await prisma.lead.findFirst({
        where: {
          userId,
          name: { contains: parsed.commissionPaid.name, mode: "insensitive" },
        },
      });
      const row = await prisma.commission.findFirst({
        where: {
          userId,
          ...(lead ? { leadId: lead.id } : {}),
          estado: { not: "COBRADA" },
        },
        orderBy: { fecha: "desc" },
      });
      if (row) {
        const cobrada = amount > 0 ? amount : row.generada;
        await prisma.commission.update({
          where: { id: row.id },
          data: {
            cobrada,
            fechaCobro: new Date(),
            estado: cobrada >= row.generada - 0.5 ? "COBRADA" : "PARCIAL",
          },
        });
      }
    }
    if (parsed.crm?.agendaAt && parsed.crm.name) {
      const when = new Date(parsed.crm.agendaAt);
      if (!Number.isNaN(when.getTime())) {
        await prisma.callRecord.create({
          data: {
            userId,
            source: "chat",
            sourceId: `agenda-${Date.now()}`,
            title: `Agendado: ${parsed.crm.name}`,
            leadName: parsed.crm.name,
            offerName: parsed.crm.offerName || "",
            estadoAgenda: "AGENDADO",
            callType: "AGENDADO",
            recordedAt: when,
            filingStatus: "confirmed",
            confirmedAt: new Date(),
            summary: `AGENDADO · ${parsed.crm.name}`,
          },
        });
        await upsertLeadForAgenda(
          prisma,
          userId,
          parsed.crm.name,
          parsed.crm.offerName || "",
        );
      }
    }
    if (parsed.projection?.metaUsd) {
      const until = parsed.projection.until
        ? new Date(parsed.projection.until)
        : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
      await saveMonthlyGoal(prisma, userId, parsed.projection.metaUsd);
      const proj = await projectCommission(prisma, userId, {
        metaUsd: parsed.projection.metaUsd,
        until,
        offerName: parsed.crm?.offerName,
      });
      parsed.reply = proj.reply;
    }
    if (parsed.crm?.name) {
      try {
        await applyCrmChatUpdate(prisma, userId, parsed.crm);
        const pending = await listPendingFilings(prisma, userId);
        const target =
          pending.find(
            (row) =>
              row.filing.leadName.toLowerCase() ===
              parsed.crm!.name!.trim().toLowerCase(),
          ) || pending[0];
        if (target) {
          await confirmCallFiling(prisma, userId, target.id, {
            leadName: parsed.crm.name,
            company: parsed.crm.company,
            offerName: parsed.crm.offerName,
            nextStep: parsed.crm.nextStep,
            nextStepAt: parsed.crm.nextStepAt,
            objections: parsed.crm.objections,
            summary: parsed.crm.lastSummary,
            decider: parsed.crm.decider,
          });
        }
      } catch (crmError) {
        console.error("hub crm", crmError);
      }
    }
    const reply = [canned.join(" "), String(parsed.reply || "").trim()]
      .filter(Boolean)
      .join(" ") || "¿Qué quieres hacer ahora?";
    const actions = (parsed.actions || [])
      .filter((item) => item.href && item.label)
      .slice(0, 2);

    const coachLine = await appendHubLines(
      prisma,
      userId,
      body.start ? null : userText,
      reply,
    );
    const fresh = await hubSnapshot(prisma, userId);
    return NextResponse.json({ message: coachLine, actions, snapshot: fresh });
  } catch (error) {
    console.error("hub POST", error);
    return NextResponse.json(
      { error: "No pude responder. Recarga e inténtalo otra vez." },
      { status: 500 },
    );
  }
}

async function hubSnapshot(
  prisma: NonNullable<Awaited<ReturnType<typeof getWorkspacePrisma>>>,
  userId: string,
) {
  const home = await getHomeState(prisma, userId);
  const prefsRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmPrefs: true },
  });
  const prefs = parseCrmPrefs(prefsRow?.crmPrefs);
  const pendingOfferExtract = readPendingOfferExtract(prefsRow?.crmPrefs);
  const goalSeed = {
    monthlyGoalUsd: prefs.monthlyGoalUsd,
    needsMonthlyGoal: home.hasOffer && prefs.monthlyGoalUsd == null,
    projection: null as Awaited<ReturnType<typeof loadCommissionProjection>>["projection"],
  };
  const empty = {
    home,
    offers: [] as string[],
    canPractice: home.canPractice,
    readyCrm: false,
    missingCrm: home.missingCrm,
    fathomCount: home.fathomCount,
    uploadCount: home.uploadCount,
    now: null as Awaited<ReturnType<typeof crmDashboard>>["now"] | null,
    comisionResumen: null as Awaited<ReturnType<typeof crmDashboard>>["comisionResumen"] | null,
    leads: [] as { name: string; status: string; offer: string; next: string }[],
    alertsDue: [] as {
      id: string;
      question: string;
      leadName: string;
      dueAt: string;
      mensajeSugerido: string;
      tipo: string;
      enJuego: number;
      contexto: string;
      opciones: unknown[];
      selectedId: string;
      telefono: string;
    }[],
    pendingCalls: [] as Awaited<ReturnType<typeof listPendingFilings>>,
    appliedCalls: [] as string[],
    recentCalls: [] as unknown[],
    monthlyGoalUsd: goalSeed.monthlyGoalUsd,
    needsMonthlyGoal: goalSeed.needsMonthlyGoal,
    projection: goalSeed.projection,
    pendingOfferExtract,
    needsPushPrompt:
      home.phase !== "a" && !prefs.pushPromptedAt && Boolean(vapidPublicKey()),
  };
  if (home.phase !== "c") {
    return empty;
  }
  try {
    const workspace = await getWorkspace(prisma, userId, null, { corpus: false });
    const dash = await crmDashboard(prisma, userId);
    let goalBundle = goalSeed;
    try {
      goalBundle = await loadCommissionProjection(prisma, userId, dash);
    } catch (error) {
      console.error("hub projection", error);
    }
    const [leads, pendingCalls, recentAuto] = await Promise.all([
      prisma.lead.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 12,
      }),
      listPendingFilings(prisma, userId),
      prisma.callRecord.findMany({
        where: {
          userId,
          filingStatus: "confirmed",
          confirmedAt: { gte: new Date(Date.now() - 36 * 3600 * 1000) },
        },
        orderBy: { confirmedAt: "desc" },
        take: 3,
      }),
    ]);
    return {
      home,
      offers: workspace.offers.map((row) => row.productName),
      canPractice: workspace.canPractice,
      readyCrm: workspace.readyCrm,
      missingCrm: home.missingCrm,
      fathomCount: workspace.fathomCount,
      uploadCount: workspace.uploadCount,
      now: dash.now,
      comisionResumen: dash.comisionResumen,
      leads: leads.map((row) => ({
        name: row.name,
        status: row.status,
        offer: row.offerName,
        next: row.nextStep,
      })),
      alertsDue: dash.followups
        .filter((row) => row.estado === "VENCIDO" || row.estado === "HOY")
        .slice(0, 8)
        .map((row) => ({
          id: row.id,
          question: row.question,
          leadName: row.cliente,
          dueAt: row.dueAt,
          mensajeSugerido: row.mensajeSugerido,
          tipo: row.tipo,
          enJuego: row.enJuego,
          contexto: row.contexto,
          opciones: row.opciones || [],
          selectedId: row.selectedId || "",
          telefono: row.telefono || "",
        })),
      pendingCalls,
      appliedCalls: recentAuto.map((row) => row.summary).filter(Boolean),
      recentCalls: [],
      monthlyGoalUsd: goalBundle.monthlyGoalUsd,
      needsMonthlyGoal: goalBundle.needsMonthlyGoal,
      projection: goalBundle.projection,
      pendingOfferExtract,
      needsPushPrompt: !prefs.pushPromptedAt && Boolean(vapidPublicKey()),
    };
  } catch (error) {
    console.error("hub snapshot crm", error);
    return empty;
  }
}

function nextHubActions(snapshot: Awaited<ReturnType<typeof hubSnapshot>>) {
  if (snapshot.home?.phase === "a") {
    return [{ type: "navigate", href: "/llamadas#conectar-fathom", label: "Conectar Fathom" }];
  }
  if (snapshot.home?.phase === "b") {
    return [{ type: "practice", href: "/practicar", label: "Practicar" }];
  }
  if (snapshot.pendingCalls.length) {
    return [{ type: "none", href: "/", label: "Responde el hueco de arriba" }];
  }
  if (snapshot.missingCrm) {
    return [{ type: "navigate", href: "/ofertas", label: "Subir oferta" }];
  }
  if (snapshot.alertsDue.length) {
    return [{ type: "navigate", href: "/", label: "Pendientes de hoy" }];
  }
  if (snapshot.canPractice) {
    return [{ type: "practice", href: "/practicar", label: "Practicar" }];
  }
  return [];
}

async function appendHubLines(
  prisma: NonNullable<Awaited<ReturnType<typeof getWorkspacePrisma>>>,
  userId: string,
  userText: string | null,
  reply: string,
) {
  try {
    const loaded = await loadThread(prisma, userId, THREAD_HUB);
    const incoming: { role: "user" | "coach"; content: string }[] = [];
    if (userText) incoming.push({ role: "user", content: userText });
    incoming.push({ role: "coach", content: reply });
    const created = await appendThreadLines(
      prisma,
      loaded.profile.id,
      THREAD_HUB,
      incoming,
    );
    return created[created.length - 1];
  } catch (error) {
    console.error("hub append", error);
    return {
      id: `tmp-${Date.now()}`,
      role: "coach" as const,
      content: reply,
      createdAt: new Date().toISOString(),
    };
  }
}
