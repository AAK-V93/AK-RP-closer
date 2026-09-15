import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import {
  generateQcReportFromTranscript,
  saveQcPracticeSession,
} from "@/lib/qc-report-service";
import { parseCallTranscript } from "@/lib/parse-transcript";
import type { QcCallReport } from "@/data/qc-report";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
    }

    const body = (await request.json()) as {
      transcript?: string;
      closerName?: string;
      productName?: string;
      uploadId?: string;
    };

    let raw = body.transcript?.trim() || "";
    let uploadId = body.uploadId?.trim() || "";
    const dbUserId = session?.user?.id;
    const prisma = getPrisma();

    if (uploadId) {
      if (!dbUserId || !prisma) {
        return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
      }
      const upload = await prisma.clientTranscript.findFirst({
        where: { id: uploadId, userId: dbUserId },
      });
      if (!upload) {
        return NextResponse.json({ error: "Llamada no encontrada" }, { status: 404 });
      }
      raw = upload.transcriptText;
      if (!body.productName) body.productName = upload.title;
    }

    if (raw.length < 200) {
      return NextResponse.json(
        { error: "Pega una transcripción más larga (mínimo unas cuantas intervenciones)." },
        { status: 400 },
      );
    }

    const parsed = parseCallTranscript(raw);
    if (parsed.lines.length < 4) {
      return NextResponse.json(
        {
          error:
            "No pude leer la transcripción. Pega el texto de Fathom (con nombres y timestamps) o un diálogo Closer/Prospecto.",
        },
        { status: 400 },
      );
    }

    let report;
    try {
      ({ report } = await generateQcReportFromTranscript({
        transcriptRaw: raw,
        closerName: body.closerName,
        productName: body.productName,
      }));
    } catch (geminiError) {
      return NextResponse.json(
        {
          error:
            "No se pudo generar el reporte a tiempo. Intenta de nuevo; si la llamada es muy larga, recorta un poco la transcripción.",
          details:
            geminiError instanceof Error ? geminiError.message : String(geminiError),
        },
        { status: 502 },
      );
    }

    let saved = false;
    let sessionId: string | null = null;
    if (dbUserId && prisma) {
      try {
        sessionId = await saveQcPracticeSession(prisma, dbUserId, {
          report,
          lines: parsed.lines,
          productName: body.productName,
        });
        saved = true;
        if (uploadId) {
          try {
            await prisma.callRecord.updateMany({
              where: { userId: dbUserId, source: "upload", sourceId: uploadId },
              data: { practiceSessionId: sessionId },
            });
          } catch {
            /* CallRecord columns may still be migrating */
          }
        }
      } catch (saveError) {
        console.error("Could not save QC report", saveError);
      }
    }

    return NextResponse.json({
      ...report,
      saved,
      sessionId,
    } as QcCallReport & {
      saved: boolean;
      sessionId: string | null;
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "No se pudo armar el reporte",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
