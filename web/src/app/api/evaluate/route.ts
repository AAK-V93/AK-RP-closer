import { NextResponse } from "next/server";
import dotenv from "dotenv";
import path from "path";
import {
  AAA_EVALUATOR_BRIEF,
  getCriteriaForSection,
} from "@/data/rubric";
import { CallSection } from "@/data/training-session";
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
}

interface CriterionScore {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  feedback: string;
}

interface EvaluateResponse {
  overallScore: number;
  criteria: CriterionScore[];
  strengths: string[];
  improvements: string[];
  coachingTips: string[];
}

export async function POST(request: Request) {
  try {
    const body: EvaluateRequest = await request.json();
    const { transcript, callSection, productName, difficulty, language } = body;

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

    const prompt = `Eres un coach de ventas. Evalúas roleplays. NO uses rúbricas de pitch/cierre/guion. Solo esto:

1) ¿El closer detectó DOLOR, DESEO y URGENCIA a profundidad, siendo curioso, con preguntas?
2) Ante objeciones o preguntas del lead: ¿usó el método 3A (Acknowledge, Associate, Ask back)?

${AAA_EVALUATOR_BRIEF}

PRODUCTO: ${productName}
DIFICULTAD DEL PROSPECTO: ${difficulty}
IDIOMA: ${lang.nativeName}
MODO DE PRÁCTICA: ${callSection} (no cambia la rúbrica; siempre evalúa lo mismo)

TRANSCRIPCIÓN:
${transcriptText}

CRITERIOS (evalúa TODOS):
${criteriaList}

Responde ÚNICAMENTE con JSON válido (sin markdown):
{
  "overallScore": <número 0-100>,
  "criteria": [
    {
      "id": "pain",
      "label": "...",
      "score": <0-10>,
      "maxScore": 10,
      "feedback": "feedback breve, cita algo concreto de la transcripción"
    }
  ],
  "strengths": ["..."],
  "improvements": ["..."],
  "coachingTips": ["consejo accionable 1", "consejo 2", "consejo 3"]
}

Reglas de scoring:
- 0-10 por criterio. 9-10 = profundidad real + el LEAD lo dijo. 6-7 = tocó el tema pero superficial. 0-4 = asumió, pitcheó, o no preguntó.
- overallScore = promedio de los 6 scores × 10.
- Dolor/deseo/urgencia: si el closer no preguntó, puntúa bajo aunque "tuviera razón".
- AAA: si el prospecto hizo al menos una pregunta u objeción, evalúa cómo la manejó (respuesta inmediata a trampa = bajo en ask; discutir = bajo en acknowledge; no hay label positivo = bajo en associate).
- Si NO hubo ninguna pregunta/objeción del lead: AAA en 5 con feedback "no hubo objeción/pregunta para practicar 3A", EXCEPTO si el closer dijo "¿tienes alguna pregunta?" → aaa_ask máximo 2.
- coachingTips: 3-5, concretos, con ejemplos de pregunta que debió hacer. Todo en ${lang.nativeName}.`;

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

    const parsed: EvaluateResponse = JSON.parse(text);
    return NextResponse.json(parsed);
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
