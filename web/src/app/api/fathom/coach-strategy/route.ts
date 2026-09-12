import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { FATHOM_STRATEGY_PROMPT, runCoachTurn } from "@/lib/coach-service";
import { requireFathomUser } from "@/lib/fathom-auth";
import { getWorkspace } from "@/lib/workspace";
import { extractLeadPlaybook } from "@/lib/lead-playbook";
import { ensureWorkspaceTables } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    const auth = await requireFathomUser();
    if ("error" in auth && auth.error) return auth.error;
    const { prisma, userId } = auth;

    const pendingAnalysis = await prisma.fathomRecording.count({
      where: {
        userId,
        transcriptText: { not: "" },
        practiceSessionId: null,
      },
    });
    if (pendingAnalysis > 0) {
      return NextResponse.json(
        {
          error: `Aún faltan ${pendingAnalysis} llamadas por auditar antes de generar la estrategia.`,
          remainingAnalyses: pendingAnalysis,
        },
        { status: 409 },
      );
    }

    const analyzedCount = await prisma.fathomRecording.count({
      where: {
        userId,
        AND: [
          { practiceSessionId: { not: null } },
          { practiceSessionId: { not: "skipped" } },
        ],
      },
    });
    if (analyzedCount === 0) {
      return NextResponse.json({
        ok: true,
        analyzedCount: 0,
        message:
          "No hubo llamadas con transcript usable en el rango elegido. Prueba una fecha más amplia o espera a que Fathom genere las transcripciones.",
      });
    }

    try {
      await ensureWorkspaceTables(prisma);
      const workspace = await getWorkspace(prisma, userId);
      if (workspace.offer && workspace.corpus.length > 0) {
        const playbook = await extractLeadPlaybook({
          productName: workspace.offer.productName,
          productDescription: workspace.offer.productDescription,
          transcripts: workspace.corpus,
        });
        await prisma.userOffer.update({
          where: { id: workspace.offer.id },
          data: { playbook: playbook as unknown as Prisma.InputJsonValue },
        });
      }
    } catch (error) {
      console.error("playbook after fathom", error);
    }

    const result = await runCoachTurn(prisma, userId, {
      closerTurn: FATHOM_STRATEGY_PROMPT,
      userMessage:
        "Acabo de importar y auditar mis llamadas de Fathom. Dame la estrategia completa.",
      evidenceLimit: 40,
    });

    return NextResponse.json({
      ok: true,
      analyzedCount,
      level: result.level,
      notes: result.notes,
      message: result.message,
    });
  } catch (error) {
    console.error("fathom coach-strategy", error);
    return NextResponse.json(
      {
        error: "El coach no pudo generar la estrategia. Intenta de nuevo.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
