import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { ensureCrmTables } from "@/lib/prisma";
import { applyAlertOutcome, resolveAlert, snoozeAlert, type AlertOutcome } from "@/lib/alerts";
import { applyAgendaCheck } from "@/lib/agenda";
import { chooseFollowupOption } from "@/lib/followup-library";
import { crmDashboard } from "@/lib/crm-metrics";
import { nextMissingCrmField } from "@/lib/offer-commercial";
import { getWorkspace } from "@/lib/workspace";

export async function GET() {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    const dash = await crmDashboard(auth.prisma, auth.userId);
    const workspace = await getWorkspace(auth.prisma, auth.userId);
    const missing = nextMissingCrmField(
      workspace.offers.map((row) => ({
        id: row.id,
        productName: row.productName,
        commercial: row.commercial,
      })),
    );
    return NextResponse.json({
      ...dash,
      missingCrm: missing,
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
    return NextResponse.json({ error: "No se pudo cargar el CRM" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    const body = (await request.json()) as {
      alertId?: string;
      action?: "resolve" | "snooze" | "outcome" | "agenda" | "pick-script";
      days?: number;
      resultado?: AlertOutcome;
      amount?: number;
      nota?: string;
      razonNoCierre?: string;
      agendaEstado?: "SHOW" | "NO SHOW" | "REPROGRAMA";
      optionId?: string;
    };
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
