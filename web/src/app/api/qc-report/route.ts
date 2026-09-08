import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import {
  generateQcReportFromTranscript,
  saveQcPracticeSession,
} from "@/lib/qc-report-service";
import {
  compactTranscriptText,
  formatParsedTranscript,
  parseCallTranscript,
} from "@/lib/parse-transcript";
import {
  FREE_QC_USED_CODE,
  assertGuestCanRunQc,
  markGuestQcCompleted,
} from "@/lib/guest-practice";
import type { QcCallReport } from "@/data/qc-report";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      const gate = await assertGuestCanRunQc(request);
      if (!gate.ok) {
        return NextResponse.json(
          {
            error:
              "Ya usaste tu reporte gratis. Crea una cuenta para auditar más llamadas.",
            code: FREE_QC_USED_CODE,
          },
          { status: 403 },
        );
      }
    }

    const body = (await request.json()) as {
      transcript?: string;
      closerName?: string;
      productName?: string;
    };
    const raw = body.transcript?.trim() || "";
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
    const dbUserId = session?.user?.id;
    const prisma = getPrisma();
    if (dbUserId && prisma) {
      try {
        await saveQcPracticeSession(prisma, dbUserId, {
          report,
          lines: parsed.lines,
          productName: body.productName,
        });
        saved = true;
      } catch (saveError) {
        console.error("Could not save QC report", saveError);
      }
    }

    let freeQcUsed = false;
    if (!dbUserId) {
      try {
        await markGuestQcCompleted(request);
        freeQcUsed = true;
      } catch (guestError) {
        console.error("Could not mark free QC", guestError);
      }
    }

    return NextResponse.json({ ...report, saved, freeQcUsed } as QcCallReport & {
      saved: boolean;
      freeQcUsed: boolean;
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
