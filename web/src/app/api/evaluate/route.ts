import { NextResponse } from "next/server";
import dotenv from "dotenv";
import path from "path";
import {
  AAA_EVALUATOR_BRIEF,
  getCriteriaForSection,
  sectionEvalNotes,
} from "@/data/rubric";
import { CallEvaluation } from "@/data/evaluation";
import { CallSection, ProspectProfile } from "@/data/training-session";
import { LanguageCode, getLanguage } from "@/data/languages";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });

interface TranscriptLine {
  role: "closer" | "prospect";
  text: string;
}

interface EvaluateRequest {
  transcript: TranscriptLine[];
  callSection: CallSection;
  productName: string;
  difficulty: string;
  language: LanguageCode;
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

export async function POST(request: Request) {
  try {
    const body: EvaluateRequest = await request.json();
    const {
      transcript,
      callSection,
      productName,
      difficulty,
      language,
      prospectProfile,
      pitchSummary,
    } = body;

    if (!transcript?.length) {
      return NextResponse.json(
        { error: "Se necesita una transcripción de la llamada" },
        { status: 400 },
      );
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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: "Error calling Gemini", details: errText },
        { status: 502 },
      );
    }

    const data = await response.json();
    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text ??
      data.candidates?.[0]?.content?.parts?.[0]?.inlineData;

    if (!text) {
      return NextResponse.json(
        { error: "Empty response from Gemini" },
        { status: 502 },
      );
    }

    const parsed: CallEvaluation = JSON.parse(text);
    return NextResponse.json({
      ...parsed,
      prospectFile: parsed.prospectFile ?? null,
      objections: parsed.objections ?? [],
      discoveryGaps: parsed.discoveryGaps ?? [],
      strengths: parsed.strengths ?? [],
      improvements: parsed.improvements ?? [],
      coachingTips: parsed.coachingTips ?? [],
      criteria: parsed.criteria ?? [],
      outcomeSummary: parsed.outcomeSummary ?? "",
    });
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
