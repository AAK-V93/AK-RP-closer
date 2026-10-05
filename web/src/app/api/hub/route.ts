import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import { generateGeminiJson } from "@/lib/gemini";
import { HUB_SYSTEM_PROMPT } from "@/lib/hub-prompt";
import { canonicalOfferName, leadMention, stripFalseListo } from "@/lib/producto-guard";
import { getWorkspacePrisma } from "@/lib/workspace";
import {
  ensureCoachTables,
  ensureCrmTables,
  ensureFathomTables,
  ensureReadIndexes,
  ensureWorkspaceTables,
  getPrisma,
} from "@/lib/prisma";
import { type CrmChatPatch } from "@/lib/file-call";
import {
  answerCrmChat,
  blockedOfferPasteReply,
  chatFailureReply,
  crmReadFailureReply,
  guardCoachReply,
  OFFER_PASTE_TEXT,
  offerPasteReplyAllowed,
  recognizedCrmQuestion,
  isChatCancel,
  looksLikeFilingAnswer,
  messageTargetsOtherLead,
  proposalFromLoosePatch,
  replyForNamedLead,
  savePendingChat,
  type ChatLead,
} from "@/lib/hub-crm-chat";
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
import { retryRead } from "@/lib/read-retry";
import { labelCrmProse, presentChatState } from "@/lib/plain-labels";
import { analyzeCardStatus, coachCardStatus, followupCardStatus } from "@/lib/home-desk";
import { projectionFromDashboard, projectCommission } from "@/lib/crm-projection";
import {
  applyCommercialAnswer,
  looksLikeOfferBlob,
  parseCommercial,
  userHasReadyCrm,
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
import { parseCrmPrefs, parseMonthlyGoalUsd, patchCrmPref, saveMonthlyGoal } from "@/lib/crm-prefs";
import { applyHubUtterance, parseHubUtterance } from "@/lib/hub-utterance";
import {
  bogotaDateLine,
  bogotaMonthName,
  buildInicioList,
  goalProgress,
  lastCloseInfo,
  monthCommissionUsd,
  offerRules,
  paraLlegarLines,
  startSteps,
  type InicioBlock,
} from "@/lib/inicio-view";
import { foldLeadName } from "@/lib/crm-followups";
import { periodOutcomes } from "@/lib/outcome-counts";
import { vapidPublicKey } from "@/lib/web-push";
import { Prisma } from "@prisma/client";

type ServerTiming = { name: string; dur: number; desc?: string };

function formatServerTiming(timings: ServerTiming[]) {
  return timings
    .map((row) => {
      const desc = row.desc ? `;desc="${row.desc.replace(/"/g, "")}"` : "";
      return `${row.name};dur=${row.dur}${desc}`;
    })
    .join(", ");
}

async function timed<T>(timings: ServerTiming[] | undefined, name: string, run: () => Promise<T>) {
  const started = performance.now();
  try {
    return await run();
  } finally {
    timings?.push({ name, dur: Math.round(performance.now() - started) });
  }
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const timings: ServerTiming[] = [];
  const origin = performance.now();
  const mark = (name: string, started: number, desc?: string) => {
    timings.push({
      name,
      dur: Math.round(performance.now() - started),
      ...(desc ? { desc } : {}),
    });
  };
  try {
    const authStarted = performance.now();
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
    });
    mark("auth", authStarted, "jwt");
    const userId = typeof token?.sub === "string" ? token.sub : "";
    if (!userId) {
      return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
    }
    const prismaStarted = performance.now();
    const prisma = getPrisma();
    mark("prisma", prismaStarted, "client");
    if (!prisma) return NextResponse.json({ error: "DB" }, { status: 503 });
    const ensureStarted = performance.now();
    await Promise.all([
      ensureWorkspaceTables(prisma),
      ensureFathomTables(prisma).catch(() => undefined),
      ensureCrmTables(prisma).catch(() => undefined),
      ensureCoachTables(prisma).catch(() => undefined),
      ensureReadIndexes(prisma).catch(() => undefined),
    ]);
    mark("ensure", ensureStarted);

    const snapshot = await hubSnapshot(prisma, userId, timings);
    const serializeStarted = performance.now();
    const payload = JSON.stringify({ snapshot });
    mark("serialize", serializeStarted, `${payload.length}b`);
    mark("total", origin);
    const dur = (name: string) => timings.find((row) => row.name === name)?.dur || 0;
    const wave = Math.max(
      ...["home", "user", "offers", "dashboard", "leads", "filings", "recent", "analyzed", "callCount", "projection"].map(
        dur,
      ),
    );
    timings.push({
      name: "gap",
      dur: Math.max(0, dur("total") - dur("auth") - dur("prisma") - dur("ensure") - wave - dur("serialize")),
      desc: "fuera de las etapas",
    });
    return new NextResponse(payload, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "Server-Timing": formatServerTiming(timings),
      },
    });
  } catch (error) {
    console.error("hub GET", error);
    return NextResponse.json(
      { error: "No se pudo cargar el inicio", messages: [], snapshot: null },
      { status: 503 },
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

    const userText = body.start ? "" : String(body.message || "").trim();

    if (userText && !body.start && isChatCancel(userText)) {
      const prefsRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { crmPrefs: true },
      });
      if (readPendingOfferExtract(prefsRow?.crmPrefs)) {
        await clearPendingOfferExtract(prisma, userId);
      }
      const crmReply = await answerCrmChat(prisma, userId, userText);
      const coachLine = await appendHubLines(
        prisma,
        userId,
        userText,
        crmReply || "Cancelé eso. No cambié nada.",
      );
      const fresh = await hubSnapshot(prisma, userId);
      return NextResponse.json({
        message: coachLine,
        actions: nextHubActions(fresh),
        snapshot: fresh,
      });
    }

    if (userText && !body.start) {
      const crmReply = await answerCrmChat(prisma, userId, userText);
      if (crmReply) {
        const coachLine = await appendHubLines(prisma, userId, userText, crmReply);
        return NextResponse.json({
          message: coachLine,
          actions: [],
        });
      }
      if (recognizedCrmQuestion(userText)) {
        console.error("crm chat fell through", userText.slice(0, 160));
        const coachLine = await appendHubLines(
          prisma,
          userId,
          userText,
          crmReadFailureReply(),
        );
        return NextResponse.json({
          message: coachLine,
          actions: [],
        });
      }
    }

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
      const fresh = await hubSnapshot(prisma, userId);
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
    const chatLeadRows = await prisma.lead.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        offerName: true,
        nextStep: true,
        lastSummary: true,
        amountPaid: true,
      },
    });
    const chatLeads: ChatLead[] = chatLeadRows.map((row) => ({
      id: row.id,
      name: row.name,
      offerName: row.offerName,
      nextStep: row.nextStep,
      lastSummary: row.lastSummary,
      amountPaid: row.amountPaid,
    }));
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
    const pendingFiling = live.pendingCalls[0];
    if (
      pendingFiling &&
      !body.start &&
      looksLikeFilingAnswer(userText) &&
      !messageTargetsOtherLead(userText, chatLeads, pendingFiling.filing?.leadName || "")
    ) {
      const pending = pendingFiling;
      const field = pending.field || "revision";
      let value = userText;
      if (field === "producto") {
        const hit = canonicalOfferName(userText, live.offerRefs?.length ? live.offerRefs : live.offers || []);
        if (!hit) {
          const names = (live.offers || []).filter(Boolean).join(", ") || "ninguna";
          const coachLine = await appendHubLines(
            prisma,
            userId,
            userText,
            `Eso no es una oferta. Las tuyas son: ${names}.`,
          );
          const fresh = await hubSnapshot(prisma, userId);
          return NextResponse.json({
            message: coachLine,
            actions: nextHubActions(fresh),
            snapshot: fresh,
          });
        }
        value = hit;
      }
      let reply = "Anotado.";
      try {
        const done = await confirmCallFiling(prisma, userId, pending.id, { field, value });
        reply =
          done && "applied" in done && done.applied && done.summary
            ? done.summary
            : done && "gap" in done && done.gap
              ? done.gap.question
              : "Anotado.";
      } catch (error) {
        console.error("hub pending filing", error);
        reply = "No anoté eso. Si hablas de un lead, dime su nombre.";
      }
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
      await patchCrmPref(prisma, userId, "whatsappE164", phone);
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
      const pasteDecision = offerPasteReplyAllowed({
        text: userText,
        offersUnreadable: Boolean(live.home?.offersUnreadable),
        missingCrm: true,
      });
      if (!pasteDecision.allow && !looksLikeOfferBlob(userText)) {
        console.warn(
          JSON.stringify({
            route: "POST /api/hub",
            reason: `blocked:${pasteDecision.reason}`,
          }),
        );
        const coachLine = await appendHubLines(
          prisma,
          userId,
          userText,
          blockedOfferPasteReply({
            text: userText,
            offersUnreadable: Boolean(live.home?.offersUnreadable),
            missingCrm: true,
          }) || crmReadFailureReply(),
        );
        return NextResponse.json({
          message: coachLine,
          actions: [],
        });
      }
      if (!looksLikeOfferBlob(userText)) {
        const coachLine = await appendHubLines(
          prisma,
          userId,
          userText,
          OFFER_PASTE_TEXT,
          true,
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
${JSON.stringify(presentChatState(live))}

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
        timeoutMs: 12_000,
        models: ["gemini-flash-latest"],
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
        canned.join(" ") ||
          "No pude armar la respuesta. Inténtalo otra vez; el chat sigue activo.",
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
    let wroteExactLead = false;
    let wroteLeadName = "";
    if (parsed.commissionPaid?.name) {
      const namedPaid = leadMention(userText, chatLeads);
      parsed.commissionPaid.name = namedPaid.kind === "exact" ? namedPaid.lead.name : "";
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
        wroteExactLead = true;
        wroteLeadName = parsed.commissionPaid.name;
      }
    }
    if (parsed.crm?.agendaAt && /agend/i.test(userText)) {
      const namedMention = leadMention(userText, chatLeads);
      const named = namedMention.kind === "exact" ? namedMention.lead : null;
      const when = new Date(parsed.crm.agendaAt);
      const offerName = canonicalOfferName(
        parsed.crm.offerName || "",
        live.offerRefs?.length ? live.offerRefs : live.offers || [],
      );
      if (named && !Number.isNaN(when.getTime())) {
        await prisma.callRecord.create({
          data: {
            userId,
            source: "chat",
            sourceId: `agenda-${Date.now()}`,
            title: `Agendado: ${named.name}`,
            leadName: named.name,
            offerName,
            estadoAgenda: "AGENDADO",
            callType: "AGENDADO",
            recordedAt: when,
            filingStatus: "confirmed",
            confirmedAt: new Date(),
            summary: `AGENDADO · ${named.name}`,
          },
        });
        await upsertLeadForAgenda(prisma, userId, named.name, offerName);
        wroteExactLead = true;
        wroteLeadName = named.name;
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
        offerName: canonicalOfferName(
          parsed.crm?.offerName || "",
          live.offerRefs?.length ? live.offerRefs : live.offers || [],
        ),
      });
      parsed.reply = proj.reply;
    }
    if (parsed.crm) {
      const loose = proposalFromLoosePatch(
        parsed.crm,
        {
          leads: chatLeads,
          calls: [],
          pending: null,
          offers: live.offers || [],
          offerRefs: live.offerRefs || [],
        },
        userText,
      );
      if (loose.kind === "confirm") {
        await savePendingChat(prisma, userId, loose.proposal);
        parsed.reply = loose.reply;
      } else if (loose.kind === "answer") {
        parsed.reply = loose.reply;
      }
    }
    parsed.reply = replyForNamedLead(String(parsed.reply || ""), userText, chatLeads);
    parsed.reply = stripFalseListo(String(parsed.reply || ""), wroteExactLead, wroteLeadName);
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
      false,
      {
        offersUnreadable: Boolean(live.home?.offersUnreadable),
        missingCrm: Boolean(live.missingCrm),
      },
    );
    let fresh: Awaited<ReturnType<typeof hubSnapshot>> | null = live;
    try {
      fresh = await hubSnapshot(prisma, userId);
    } catch (error) {
      console.error("hub snapshot after reply", error);
    }
    return NextResponse.json({ message: coachLine, actions, snapshot: fresh });
  } catch (error) {
    console.error("hub POST", error);
    const content = chatFailureReply(error);
    return NextResponse.json({
      message: {
        id: `err-${Date.now()}`,
        role: "coach",
        content,
        createdAt: new Date().toISOString(),
      },
    });
  }
}

async function hubSnapshot(
  prisma: NonNullable<Awaited<ReturnType<typeof getWorkspacePrisma>>>,
  userId: string,
  timings?: ServerTiming[],
) {
  const homePromise = timed(timings, "home", () => getHomeState(prisma, userId));
  const prefsPromise = timed(timings, "user", () =>
    prisma.user.findUnique({
      where: { id: userId },
      select: { crmPrefs: true },
    }),
  );
  const weekStart = new Date();
  const weekday = weekStart.getUTCDay();
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  weekStart.setUTCHours(0, 0, 0, 0);
  const heavyPromise = Promise.all([
    timed(timings, "offers", () =>
      retryRead(
        "hub offers",
        () =>
          prisma.userOffer.findMany({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            select: { productName: true, commercial: true },
          }),
        (rows) => rows.length === 0,
      ).then(
        (rows) => ({ rows, unreadable: false as const }),
        (error) => {
          console.error("hub offers failed", error);
          return {
            rows: [] as { productName: string; commercial: unknown }[],
            unreadable: true as const,
          };
        },
      ),
    ),
    timed(timings, "dashboard", () => crmDashboard(prisma, userId, { scripts: false, timings })),
    timed(timings, "leads", () =>
      prisma.lead.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: { name: true, status: true, offerName: true, nextStep: true },
      }),
    ),
    timed(timings, "filings", () => listPendingFilings(prisma, userId)),
    timed(timings, "recent", () =>
      prisma.callRecord.findMany({
        where: {
          userId,
          filingStatus: "confirmed",
          confirmedAt: { gte: new Date(Date.now() - 36 * 3600 * 1000) },
        },
        orderBy: { confirmedAt: "desc" },
        take: 3,
        select: { summary: true },
      }),
    ),
    timed(timings, "analyzed", () =>
      prisma.callRecord.count({
        where: {
          userId,
          filingStatus: "confirmed",
          confirmedAt: { gte: weekStart },
          estadoAgenda: { notIn: ["INTERNA", "NO_COMERCIAL"] },
        },
      }),
    ),
    timed(timings, "callCount", () =>
      prisma.callRecord.count({
        where: {
          userId,
          source: { in: ["fathom", "upload", "qc"] },
          filingStatus: { not: "skipped" },
        },
      }),
    ),
  ]);
  void heavyPromise.catch(() => undefined);
  const [home, prefsRow] = await Promise.all([homePromise, prefsPromise]);
  const prefs = parseCrmPrefs(prefsRow?.crmPrefs);
  const pendingOfferExtract = readPendingOfferExtract(prefsRow?.crmPrefs);
  const goalSeed = {
    monthlyGoalUsd: prefs.monthlyGoalUsd,
    needsMonthlyGoal: home.hasOffer && prefs.monthlyGoalUsd == null,
    projection: null as ReturnType<typeof projectionFromDashboard>["projection"],
  };
  const empty = {
    home,
    offers: [] as string[],
    offerRefs: [] as { productName: string; aliases: string[] }[],
    canPractice: home.canPractice,
    readyCrm: Boolean(home.hasOffer && !home.missingCrm),
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
    desk: {
      unclassified: 0,
      analyzeStatus: "Todo al día",
      followupStatus: "Todo al día",
      practiceHref: "/practicar",
      practiceStatus: "Elige con quién practicar",
      coachStatus: "Sin novedades",
    },
    appliedCalls: [] as string[],
    recentCalls: [] as unknown[],
    monthlyGoalUsd: goalSeed.monthlyGoalUsd,
    needsMonthlyGoal: goalSeed.needsMonthlyGoal,
    projection: goalSeed.projection,
    pendingOfferExtract,
    needsPushPrompt:
      home.phase !== "a" && !prefs.pushPromptedAt && Boolean(vapidPublicKey()),
    inicio: null as InicioBlock | null,
  };
  timings?.push({ name: "phase", dur: 0, desc: home.phase });
  if (home.phase !== "c") {
    void heavyPromise.catch((error) => console.error("hub snapshot idle", error));
    return empty;
  }
  try {
    const [offerRead, dash, leads, pendingCalls, recentAuto, analyzedThisWeek, callCount] =
      await heavyPromise;
    const offers = offerRead.rows;
    const unclassified = pendingCalls.length;
    let goalBundle = goalSeed;
    try {
      goalBundle = projectionFromDashboard({
        monthlyGoalUsd: prefs.monthlyGoalUsd,
        hasOffer: home.hasOffer,
        callCount,
        dash,
        listPrice: dash.projectionSeed?.listPrice || 0,
        commission: dash.projectionSeed?.commission || null,
      });
      timings?.push({ name: "projection", dur: 0, desc: "in-memory" });
    } catch (error) {
      console.error("hub projection", error);
    }
    let inicio: InicioBlock | null = null;
    try {
      inicio = inicioBlock({
        dash,
        offers,
        unclassified,
        metaUsd: goalBundle.monthlyGoalUsd,
        projection: goalBundle.projection,
        hasCalls: home.hasRealCalls,
      });
      timings?.push({ name: "inicio", dur: 0, desc: "in-memory" });
    } catch (error) {
      console.error("hub inicio", error);
    }
    const desk = {
      unclassified,
      analyzeStatus: analyzeCardStatus(unclassified),
      followupStatus: followupCardStatus(
        dash.now.seguimientosHoy || 0,
        dash.now.seguimientosVencidos || 0,
      ),
      practiceHref: "/practicar",
      practiceStatus: "Elige con quién practicar",
      coachStatus: coachCardStatus({
        newPattern: false,
        analyzedThisWeek,
      }),
    };
    return {
      home,
      offers: offers.map((row) => row.productName).filter(Boolean),
      offerRefs: offers
        .filter((row) => row.productName)
        .map((row) => ({
          productName: row.productName,
          aliases: parseCommercial(row.commercial).aliases,
        })),
      canPractice: home.canPractice,
      readyCrm: offerRead.unreadable
        ? Boolean(home.hasOffer && !home.missingCrm)
        : userHasReadyCrm(offers),
      missingCrm: offerRead.unreadable ? null : home.missingCrm,
      fathomCount: home.fathomCount,
      uploadCount: home.uploadCount,
      now: dash.now,
      pipelineDetalle: dash.pipelineDetalle,
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
      desk,
      appliedCalls: recentAuto.map((row) => row.summary).filter(Boolean),
      recentCalls: [],
      monthlyGoalUsd: goalBundle.monthlyGoalUsd,
      needsMonthlyGoal: goalBundle.needsMonthlyGoal,
      projection: goalBundle.projection,
      pendingOfferExtract,
      needsPushPrompt: !prefs.pushPromptedAt && Boolean(vapidPublicKey()),
      inicio,
    };
  } catch (error) {
    console.error("hub snapshot crm", error);
    return empty;
  }
}

/** «Qué quedó» is the agreement written on the follow-up's call, the same one /crm shows as Acuerdo. */
function withCallAgreement<T extends { callId?: string; cliente?: string; proximo?: string }>(
  rows: T[],
  operacion: { id: string; acuerdo?: string }[],
  leads: { name?: string | null; nextStep?: string | null }[],
) {
  const byCall = new Map(operacion.map((row) => [row.id, String(row.acuerdo || "").trim()]));
  const nextByName = new Map<string, string>();
  for (const lead of leads) {
    const key = foldLeadName(String(lead.name || ""));
    const next = String(lead.nextStep || "").trim();
    if (key && next) nextByName.set(key, next);
  }
  return rows.map((row) => {
    const proximo = String(row.proximo || "");
    return {
      ...row,
      callAcuerdo: byCall.get(String(row.callId || "")) || "",
      leadNextStep: nextByName.get(foldLeadName(String(row.cliente || ""))) || "",
      proximoNote: proximo.replace(/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?/, "").trim(),
    };
  });
}

/** Confirmed closes already sitting in Operación. No extra query. */
function confirmedCloses(
  operacion: {
    id?: string;
    cliente?: string;
    oferta?: string;
    producto?: string;
    estadoAgenda?: string;
    interna?: boolean;
    filingStatus?: string;
  }[],
) {
  return operacion
    .filter((row) => {
      if (row.interna) return false;
      if (String(row.id || "").startsWith("lead:")) return false;
      if (String(row.filingStatus || "") !== "confirmed") return false;
      if (String(row.estadoAgenda || "").toUpperCase() !== "CIERRE VENTA") return false;
      return Boolean(String(row.cliente || "").trim());
    })
    .map((row) => ({
      name: String(row.cliente || "").trim(),
      offer: String(row.oferta || row.producto || "").trim(),
    }))
    .filter((row) => row.offer);
}

/** Inicio's goal card and list, from rows the dashboard already loaded. No extra query. */
function inicioBlock(args: {
  dash: Awaited<ReturnType<typeof crmDashboard>>;
  offers: { productName: string; commercial: unknown }[];
  unclassified: number;
  metaUsd: number | null;
  projection: ReturnType<typeof projectionFromDashboard>["projection"];
  hasCalls: boolean;
}): InicioBlock {
  const now = new Date();
  const { dash } = args;
  const goal = goalProgress({
    llevasUsd: monthCommissionUsd(dash.commissions, now),
    metaUsd: args.metaUsd,
    now,
  });
  const list = buildInicioList({
    followups: withCallAgreement(dash.followups, dash.operacion, dash.leads),
    rules: offerRules(args.offers),
    mesCash: dash.rendimiento.mes.cash,
    now,
    successes: confirmedCloses(dash.operacion),
    calls: dash.operacion,
    leadOffers: dash.leads.map((row) => ({ name: row.name, offer: row.offerName })),
  });
  const outcomes = periodOutcomes({
    calls: dash.operacion
      .filter((row) => !row.interna)
      .map((row) => ({
        cliente: row.cliente,
        fecha: row.fecha,
        estadoAgenda: row.estadoAgenda,
        leadStatus: row.leadStatus,
        seguimientoResultado: row.seguimientoResultado,
        razonNoCierre: row.razonNoCierre,
      })),
    period: "mes",
    now,
  });
  const offersLoaded = args.offers.some((row) => String(row.productName || "").trim());
  return {
    dateLine: bogotaDateLine(now),
    monthName: bogotaMonthName(now),
    goal,
    paraLlegar: paraLlegarLines({
      llevasUsd: goal.llevasUsd,
      metaUsd: goal.metaUsd,
      offerName: dash.offers[0]?.productName || "",
      projection: args.projection,
      lastClose: lastCloseInfo(dash.operacion, now),
      outcomes,
    }),
    list,
    porConfirmar: args.unclassified,
    onboarding: startSteps({
      hasGoal: goal.metaUsd != null,
      openFollowups: list.total,
      offersLoaded,
      hasCalls: args.hasCalls,
    }),
  };
}

function nextHubActions(snapshot: Awaited<ReturnType<typeof hubSnapshot>>) {
  if (snapshot.home?.phase === "a") {
    return [{ type: "navigate", href: "/llamadas#conectar-fathom", label: "Conectar Fathom" }];
  }
  if (snapshot.home?.phase === "b") {
    return [{ type: "practice", href: "/practicar", label: "Practicar" }];
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
  allowOfferPaste = false,
  paste?: { offersUnreadable?: boolean; missingCrm?: boolean },
) {
  const shown = labelCrmProse(guardCoachReply(userText || "", reply, allowOfferPaste, paste));
  if (shown.includes("Pega todo junto")) {
    console.warn(
      JSON.stringify({
        route: "POST /api/hub",
        reason: "returned-offer-paste",
      }),
    );
  }
  try {
    const loaded = await loadThread(prisma, userId, THREAD_HUB);
    const incoming: { role: "user" | "coach"; content: string }[] = [];
    if (userText) incoming.push({ role: "user", content: userText });
    incoming.push({ role: "coach", content: shown });
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
      content: shown,
      createdAt: new Date().toISOString(),
    };
  }
}
