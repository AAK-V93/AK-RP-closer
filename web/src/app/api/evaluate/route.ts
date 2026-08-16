import { NextResponse } from "next/server";
import dotenv from "dotenv";
import path from "path";
import { getServerSession } from "next-auth";
import {
  AAA_EVALUATOR_BRIEF,
  getCriteriaForSection,
  sectionEvalNotes,
} from "@/data/rubric";
import { CallEvaluation } from "@/data/evaluation";
import { CallSection, ProspectProfile } from "@/data/training-session";
import { LanguageCode, getLanguage } from "@/data/languages";
import { authOptions } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generateGeminiJson } from "@/lib/gemini";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

export const runtime = "nodejs";
export const maxDuration = 60;

interface TranscriptLine {
  role: "closer" | "prospect";
  text: string;
}

interface EvaluateRequest {
  transcript?: TranscriptLine[];
  sessionId?: string;
  callSection?: CallSection;
  productName?: string;
  difficulty?: string;
  language?: LanguageCode;
  prospectProfile?: ProspectProfile;
  pitchSummary?: string;
}

function formatKnownDiscovery(profile?: ProspectProfile, pitchSummary?: string) {
  if (!profile) return "No hay ficha previa; usa solo la transcripción.";
  return `Nombre: ${profile.name}, ${profile.age}, ${profile.occupation}, ${profile.location}
Dolores: ${profile.pains.join(" | ")}
Deseo: ${profile.desire}
Urgencia: ${profile.urgency}
Intentos previos: ${profile.pastAttempts}
Pareja: ${profile.partnerSituation}
Dinero: ${profile.moneySituation}
Tiempo: ${profile.timeSituation}
Objeciones esperadas: ${profile.objections.join(" | ")}
Precalificación: meta=${profile.preQualification.mainGoal}; situación=${profile.preQualification.currentSituation}; timeline=${profile.preQualification.timeline}; presupuesto=${profile.preQualification.budgetRange}; decisor=${profile.preQualification.decisionMaker}
${pitchSummary?.trim() ? `Resumen del pitch ya oído:\n${pitchSummary.trim()}` : ""}`;
}

async function authedDb() {
  const session = await getServerSession(authOptions);
  const prisma = getPrisma();
  const userId = session?.user?.id;
  if (!prisma || !userId) return null;
  return { prisma, userId };
}

export async function POST(request: Request) {
  try {
    const body: EvaluateRequest = await request.json();
    const {
      sessionId,
      transcript: bodyTranscript,
      callSection: bodySection,
      productName: bodyProduct,
      difficulty: bodyDifficulty,
      language: bodyLanguage,
      prospectProfile: bodyProfile,
      pitchSummary: bodyPitch,
    } = body;

    const db = await authedDb();
    let existingId: string | null = sessionId ?? null;
    let transcript = bodyTranscript ?? [];
    let callSection = bodySection;
    let productName = bodyProduct;
    let difficulty = bodyDifficulty;
    let language = bodyLanguage;
    let prospectProfile = bodyProfile;
    let pitchSummary = bodyPitch;

    if (sessionId && db) {
      const row = await db.prisma.practiceSession.findFirst({
        where: { id: sessionId, userId: db.userId },
      });
      if (!row) {
        return NextResponse.json({ error: "Práctica no encontrada" }, { status: 404 });
      }
      transcript = (row.transcript as TranscriptLine[]) || [];
      callSection = row.callSection as CallSection;
      productName = row.productName;
      difficulty = row.difficulty;
      language = row.language as LanguageCode;
      const stored = (row.evaluation || {}) as {
        prospectProfile?: ProspectProfile;
        pitchSummary?: string;
      };
      prospectProfile = prospectProfile || stored.prospectProfile;
      pitchSummary = pitchSummary || stored.pitchSummary;
    }

    if (!transcript?.length) {
      return NextResponse.json(
        { error: "Se necesita una transcripción de la llamada" },
        { status: 400 },
      );
    }

    if (!callSection || !productName) {
      return NextResponse.json(
        { error: "Faltan datos de la práctica" },
        { status: 400 },
      );
    }

    if (db && !existingId) {
      try {
        const pending = await db.prisma.practiceSession.create({
          data: {
            userId: db.userId,
            callSection,
            productName,
            difficulty,
            language,
            overallScore: 0,
            outcomeSummary: "Evaluación pendiente",
            transcript: transcript as unknown as Prisma.InputJsonValue,
            evaluation: {
              pending: true,
              prospectProfile: prospectProfile ?? null,
              pitchSummary: pitchSummary ?? null,
            } as Prisma.InputJsonValue,
            criterionScores: [] as Prisma.InputJsonValue,
            scored: false,
          },
        });
        existingId = pending.id;
      } catch (saveError) {
        console.error("Could not save pending practice", saveError);
      }
    }

    const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
    if (!geminiApiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500 },
      );
    }

    const criteria = getCriteriaForSection(callSection);
    const criteriaList = criteria
      .map((c) => `- ${c.id}: ${c.label} — ${c.description}`)
      .join("\n");

    const transcriptText = transcript
      .map((line) => `${line.role === "closer" ? "CLOSER" : "PROSPECTO"}: ${line.text}`)
      .join("\n");

    const lang = getLanguage(language ?? "es");
    const knownDiscovery = formatKnownDiscovery(prospectProfile, pitchSummary);

    const prompt = `Eres un coach de QC de llamadas de ventas (estilo reporte de control de calidad). Evalúas roleplays.

Habilidades:
1) Detectar DOLOR, DESEO y URGENCIA a profundidad, con preguntas (si el modo incluye descubrimiento).
2) Ante objeciones/preguntas: 3A (Acknowledge, Associate, Ask back).
3) En cierre/pitch: USAR lo descubierto. Cada objeción se ancla a citas y hechos del lead. 3A genérico = insuficiente.

${AAA_EVALUATOR_BRIEF}

PRODUCTO: ${productName}
DIFICULTAD: ${difficulty}
IDIOMA: ${lang.nativeName}
${sectionEvalNotes(callSection)}

FICHA / DESCUBRIMIENTO YA CONOCIDO (en modos pitch/cierre esto YA se descubrió; el closer lo tiene en pantalla):
${knownDiscovery}

TRANSCRIPCIÓN:
${transcriptText}

CRITERIOS (evalúa SOLO estos):
${criteriaList}

Responde ÚNICAMENTE JSON válido:
{
  "overallScore": <0-100>,
  "outcomeSummary": "1-2 frases: qué pasó (¿avanzó? ¿objeción de dinero/pareja/tiempo? ¿se ancló al caso?)",
  "criteria": [
    {
      "id": "use_discovery",
      "label": "...",
      "score": <0-10>,
      "maxScore": 10,
      "feedback": "cita algo concreto"
    }
  ],
  "prospectFile": {
    "pain": "dolor real hallado o 'no se llegó'",
    "desire": "...",
    "urgency": "...",
    "quotes": ["citas textuales del lead"],
    "moneySignals": "señales de dinero/capacidad si las hay",
    "decisionContext": "quién decide, pareja, etc."
  },
  "objections": [
    {
      "quote": "cita de la objeción",
      "category": "dinero | tiempo | pareja | feature | otro",
      "realRoot": "raíz real, no la etiqueta superficial",
      "howHandled": "qué hizo el closer",
      "whyFailedOrWorked": "por qué funcionó o falló; ¿usó el descubrimiento?",
      "suggestedLine": "frase 3A que CITA dolor/deseo/urgencia de ESTE lead (como: 'me comentaste que... si el dinero no fuera el tema, ¿hay algo más que te frene?')"
    }
  ],
  "discoveryGaps": [
    {
      "whatWasMissed": "qué no se profundizó",
      "howItFedObjection": "cómo eso alimentó la objeción posterior",
      "suggestedQuestion": "pregunta concreta que debió hacer"
    }
  ],
  "strengths": ["..."],
  "improvements": ["..."],
  "coachingTips": ["3-5 consejos accionables"]
}

Reglas:
- overallScore = promedio de los criterios listados × 10.
- use_discovery: 8-10 solo si el closer menciona hechos/citas del caso al objetar. 0-4 si 3A genérico, downsell, o acepta reagendar sin anclar.
- Si no hubo objeción: objections=[] y use_discovery=5 con feedback de que no hubo objeción, EXCEPTO «¿tienes alguna pregunta?» → aaa_ask máximo 2.
- discoveryGaps: solo si un hueco de indagar alimentó una objeción. Si el modo es solo cierre, usa la ficha conocida: el closer debía USARLA, no redescubrirla.
- suggestedLine siempre en primera persona, lista para decirle a ESTE lead.
- Todo en ${lang.nativeName}.`;

    let text: string;
    try {
      text = await generateGeminiJson(prompt, 0.3);
    } catch (geminiError) {
      return NextResponse.json(
        {
          error: "No se pudo evaluar con Gemini",
          details:
            geminiError instanceof Error ? geminiError.message : String(geminiError),
          saved: Boolean(existingId),
        },
        { status: 502 },
      );
    }

    const parsed: CallEvaluation = JSON.parse(text);
    const evaluation: CallEvaluation = {
      ...parsed,
      prospectFile: parsed.prospectFile ?? null,
      objections: parsed.objections ?? [],
      discoveryGaps: parsed.discoveryGaps ?? [],
      strengths: parsed.strengths ?? [],
      improvements: parsed.improvements ?? [],
      coachingTips: parsed.coachingTips ?? [],
      criteria: parsed.criteria ?? [],
      outcomeSummary: parsed.outcomeSummary ?? "",
    };

    let saved = Boolean(existingId);
    if (db && existingId) {
      try {
        await db.prisma.practiceSession.update({
          where: { id: existingId },
          data: {
            overallScore: evaluation.overallScore ?? 0,
            outcomeSummary: evaluation.outcomeSummary ?? "",
            evaluation: JSON.parse(JSON.stringify(evaluation)) as Prisma.InputJsonValue,
            criterionScores: JSON.parse(
              JSON.stringify(evaluation.criteria),
            ) as Prisma.InputJsonValue,
            scored: true,
          },
        });
        saved = true;
      } catch (saveError) {
        console.error("Could not update scored practice", saveError);
      }
    }

    return NextResponse.json({ ...evaluation, saved });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Evaluation failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
