import { loadStages } from "@/lib/person-load";
import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { ensureCrmTables } from "@/lib/prisma";
import { applyAlertOutcome, resolveAlert, snoozeAlert, type AlertOutcome } from "@/lib/alerts";
import { applyDeskFollowup, reopenDeskFollowup, type DeskResultado } from "@/lib/followup-close";
import { applyAgendaCheck } from "@/lib/agenda";
import { chooseFollowupOption } from "@/lib/followup-library";
import { crmDashboard } from "@/lib/crm-metrics";
import { nextMissingCrmField } from "@/lib/offer-commercial";
import { loadCommissionProjection } from "@/lib/crm-projection";
import { setRecordedCash } from "@/lib/crm-cash";
import { saveMonthlyGoal } from "@/lib/crm-prefs";
import { renameShownLead } from "@/lib/crm-rename";
import { deleteOperacionRow } from "@/lib/crm-delete-row";

export async function GET() {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    let dash: Awaited<ReturnType<typeof crmDashboard>>;
    try {
      dash = await crmDashboard(auth.prisma, auth.userId);
    } catch (error) {
      console.error("crm GET", error);
      return NextResponse.json({
        readyCrm: false,
        today: "",
        now: {
          seguimientosVencidos: 0,
          seguimientosHoy: 0,
          agendasHoy: 0,
          dineroEnJuego: 0,
          cashPendiente: 0,
          comisionPendiente: 0,
          oportunidadesActivas: 0,
          agendasFuturas: 0,
        },
        rendimiento: null,
        desglose: {
          porOferta: [],
          embudo: { agendas: 0, shows: 0, cierres: 0 },
          razonNoCierre: [],
          etapaPerdida: [],
        },
        evolucion: [],
        followups: [],
        commissions: [],
        comisionResumen: { generada: 0, cobrada: 0, pendiente: 0, pctCobrado: 0 },
        leads: [],
        offers: [],
        operacion: [],
        missingCrm: null,
        monthlyGoalUsd: null,
        needsMonthlyGoal: false,
        projection: null,
        warning: "No pude leer todo el CRM. Recarga en un momento.",
        metrics: { total: 0, closed: 0, closeRate: 0, pendingAlerts: 0 },
        alerts: [],
      });
    }
    const offers = await auth.prisma.userOffer.findMany({
      where: { userId: auth.userId },
      select: { id: true, productName: true, commercial: true },
      orderBy: { updatedAt: "desc" },
    });
    const missing = nextMissingCrmField(offers);
    const goal = await loadCommissionProjection(auth.prisma, auth.userId, dash);
    const stages = await loadStages(auth.prisma, auth.userId).catch((error) => {
      console.error("crm stages", error);
      return {} as Record<string, string>;
    });
    return NextResponse.json({
      ...dash,
      stages,
      missingCrm: missing,
      monthlyGoalUsd: goal.monthlyGoalUsd,
      needsMonthlyGoal: goal.needsMonthlyGoal,
      projection: goal.projection,
      metrics: {
        total: dash.leads.length,
        closed: dash.rendimiento.mes.cierres,
        closeRate: Math.round(dash.rendimiento.mes.closeRate * 100),
        pendingAlerts: dash.now.seguimientosVencidos + dash.now.seguimientosHoy,
      },
      alerts: dash.followups.map((row) => ({
        id: row.id,
        question: row.question,
        dueAt: row.dueAt,
        type: row.tipo,
        leadName: row.cliente,
        overdue: row.estado === "VENCIDO",
        estado: row.estado,
        mensajeSugerido: row.mensajeSugerido,
        enJuego: row.enJuego,
        canal: row.canal,
        telefono: row.telefono,
        oferta: row.oferta,
        contexto: row.contexto,
        opciones: row.opciones || [],
        selectedId: row.selectedId || "",
      })),
    });
  } catch (error) {
    console.error("crm GET", error);
    return NextResponse.json({
      readyCrm: false,
      today: "",
      now: {
        seguimientosVencidos: 0,
        seguimientosHoy: 0,
        agendasHoy: 0,
        dineroEnJuego: 0,
        cashPendiente: 0,
        comisionPendiente: 0,
        oportunidadesActivas: 0,
        agendasFuturas: 0,
      },
      followups: [],
      operacion: [],
      commissions: [],
      offers: [],
      warning: "No pude leer todo el CRM. Recarga en un momento.",
    });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    const body = (await request.json()) as {
      alertId?: string;
      commissionId?: string;
      action?:
        | "resolve"
        | "snooze"
        | "outcome"
        | "reabrir"
        | "agenda"
        | "pick-script"
        | "commission-paid"
        | "monthly-goal"
        | "set-cash"
        | "delete-row"
        | "rename-lead"
        | "set-phone";
      callId?: string;
      leadId?: string;
      name?: string;
      days?: number;
      resultado?: AlertOutcome;
      nextAt?: string;
      amount?: number;
      nota?: string;
      razonNoCierre?: string;
      agendaEstado?: "SHOW" | "NO SHOW" | "REPROGRAMA";
      optionId?: string;
      telefono?: string;
    };
    if (body.action === "commission-paid" && body.commissionId) {
      const row = await auth.prisma.commission.findFirst({
        where: { id: body.commissionId, userId: auth.userId },
      });
      if (!row) {
        return NextResponse.json({ error: "Comisión no encontrada" }, { status: 404 });
      }
      const cobrada = body.amount && body.amount > 0 ? body.amount : row.generada;
      await auth.prisma.commission.update({
        where: { id: row.id },
        data: {
          cobrada,
          fechaCobro: new Date(),
          estado: cobrada >= row.generada - 0.5 ? "COBRADA" : "PARCIAL",
        },
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "delete-row") {
      const out = await deleteOperacionRow(auth.prisma, auth.userId, String(body.callId || ""));
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 404 });
      }
      return NextResponse.json(out);
    }
    if (body.action === "set-cash") {
      const out = await setRecordedCash(auth.prisma, auth.userId, String(body.callId || ""), body.amount);
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }
    if (body.action === "rename-lead") {
      const out = await renameShownLead(auth.prisma, auth.userId, {
        callId: body.callId,
        leadId: body.leadId,
        name: String(body.name || ""),
      });
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, name: out.name });
    }
    if (body.action === "set-phone") {
      const telefono = String(body.telefono || "").replace(/[^\d+\s()-]/g, "").trim();
      const digits = telefono.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) {
        return NextResponse.json({ error: "Escribe el número con código de país, por ejemplo +57 300 123 4567." }, { status: 400 });
      }
      const lead = await auth.prisma.lead.findFirst({
        where: { id: String(body.leadId || ""), userId: auth.userId },
        select: { id: true },
      });
      if (!lead) return NextResponse.json({ error: "No encontré a esa persona." }, { status: 404 });
      await auth.prisma.lead.update({ where: { id: lead.id }, data: { telefono } });
      return NextResponse.json({ ok: true, telefono });
    }
    if (body.action === "monthly-goal") {
      const saved = await saveMonthlyGoal(auth.prisma, auth.userId, Number(body.amount || 0));
      if (!saved) {
        return NextResponse.json({ error: "Meta inválida" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, monthlyGoalUsd: saved });
    }
    if (!body.alertId) {
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }
    if (body.action === "pick-script" && body.optionId) {
      const out = await chooseFollowupOption(auth.prisma, auth.userId, body.alertId, body.optionId);
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 404 });
      }
      return NextResponse.json({ ...out });
    }
    if (body.action === "agenda" && body.agendaEstado) {
      const out = await applyAgendaCheck(auth.prisma, auth.userId, body.alertId, body.agendaEstado);
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 404 });
      }
      return NextResponse.json({ ...out });
    }
    if (body.action === "reabrir") {
      const out = await reopenDeskFollowup(auth.prisma, auth.userId, body.alertId);
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 404 });
      }
      return NextResponse.json({ ...out });
    }
    const deskActions = new Set<DeskResultado>([
      "hecho",
      "no_contesto",
      "mostro",
      "no_mostro",
      "perdido",
      "cerro",
      "reprogramado",
      "pago",
    ]);
    if (body.action === "outcome" && body.resultado && deskActions.has(body.resultado as DeskResultado)) {
      const out = await applyDeskFollowup(auth.prisma, auth.userId, {
        alertId: body.alertId,
        resultado: body.resultado as DeskResultado,
        nextAt: body.nextAt,
        amount: body.amount,
        nota: body.nota,
        razonNoCierre: body.razonNoCierre,
      });
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 400 });
      }
      return NextResponse.json({ ...out });
    }
    if (body.action === "outcome" && body.resultado) {
      const out = await applyAlertOutcome(auth.prisma, auth.userId, body.alertId, {
        resultado: body.resultado,
        amount: body.amount,
        nota: body.nota,
        razonNoCierre: body.razonNoCierre,
      });
      if ("error" in out) {
        return NextResponse.json({ error: out.error }, { status: 404 });
      }
      return NextResponse.json({ ...out });
    }
    if (body.action !== "resolve" && body.action !== "snooze") {
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }
    const row =
      body.action === "resolve"
        ? await resolveAlert(auth.prisma, auth.userId, body.alertId)
        : await snoozeAlert(auth.prisma, auth.userId, body.alertId, body.days || 1);
    if (!row) {
      return NextResponse.json({ error: "Alerta no encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("crm PATCH", error);
    return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
  }
}
