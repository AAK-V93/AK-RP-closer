import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureCrmTables, getPrisma, isDatabaseConfigured } from "@/lib/prisma";
import { buildCoachingInsights } from "@/lib/coaching";
import { buildCoachOffers } from "@/lib/coach-offers";
import { evidenceSessionFilter } from "@/lib/chat-threads";
import { isCoachThreadSection } from "@/lib/closer-coach";
import { loadLiveGuides } from "@/lib/live-guide";
import { loadDashboardCalls } from "@/lib/crm-call-read";
import { operacionFromCall } from "@/lib/crm-operacion";
import { foldLeadName } from "@/lib/crm-followups";

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "La base de datos no está configurada" },
      { status: 503 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
  }

  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: "DB no disponible" }, { status: 503 });
  }

  try {
    const rows = await prisma.practiceSession.findMany({
      where: {
        userId: session.user.id,
        ...evidenceSessionFilter(),
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const visible = rows.filter((row) => !isCoachThreadSection(row.callSection));
    const liveGuides = await loadLiveGuides(prisma, session.user.id);
    let coachBoard = buildCoachOffers({ calls: [], offerNames: liveGuides.map((guide) => guide.offerName) });
    try {
      await ensureCrmTables(prisma);
      const [{ allCalls }, leads] = await Promise.all([
        loadDashboardCalls(prisma, session.user.id),
        prisma.lead.findMany({
          where: { userId: session.user.id },
          select: { name: true, status: true, offerName: true, razonNoCierre: true },
        }),
      ]);
      const leadByName = new Map(leads.map((lead) => [lead.name.trim().toLowerCase(), lead]));
      const statusByName = new Map(leads.map((lead) => [foldLeadName(lead.name), lead.status]));
      const evidence = allCalls.map((call) => {
        const lead = leadByName.get((call.leadName || "").trim().toLowerCase()) || null;
        const view = operacionFromCall(call, lead);
        return {
          id: view.id,
          cliente: view.cliente,
          fecha: view.fecha,
          estadoAgenda: view.estadoAgenda,
          leadStatus: statusByName.get(foldLeadName(view.cliente)) || lead?.status || "",
          seguimientoResultado: view.seguimientoResultado,
          razonNoCierre: view.razonNoCierre,
          fechaProximo: view.fechaProximo,
          oferta: view.oferta || view.producto,
          producto: view.producto,
          interna: view.interna,
        };
      });
      for (const lead of leads) {
        evidence.push({
          id: `lead:${lead.name}`,
          cliente: lead.name,
          fecha: "",
          estadoAgenda: "",
          leadStatus: lead.status,
          seguimientoResultado: "",
          razonNoCierre: lead.razonNoCierre,
          fechaProximo: "",
          oferta: lead.offerName,
          producto: "",
          interna: false,
        });
      }
      coachBoard = buildCoachOffers({
        calls: evidence,
        offerNames: liveGuides.map((guide) => guide.offerName),
      });
    } catch (error) {
      console.error("coach offers", error);
    }

    return NextResponse.json({
      ...buildCoachingInsights(visible),
      liveGuides,
      coachBoard,
    });
  } catch (error) {
    console.error("coach insights", error);
    return NextResponse.json(
      {
        error: "No se pudieron cargar las prácticas",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
