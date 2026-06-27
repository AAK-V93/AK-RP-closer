import { NextResponse } from "next/server";
import dotenv from "dotenv";
import path from "path";
import { getCriteriaForSection } from "@/data/rubric";
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

    const prompt = `Eres un coach experto en ventas de alto ticket. Evalúa la siguiente llamada de roleplay.

PRODUCTO: ${productName}
DIFICULTAD DEL PROSPECTO: ${difficulty}
IDIOMA DE LA LLAMADA: ${lang.nativeName}
SECCIÓN PRACTICADA: ${callSection}

TRANSCRIPCIÓN:
${transcriptText}

RÚBRICA (evalúa SOLO estos criterios):
${criteriaList}

Responde ÚNICAMENTE con JSON válido (sin markdown) con esta estructura:
{
  "overallScore": <número 0-100>,
  "criteria": [
    {
      "id": "p1",
      "label": "...",
      "score": <0-10>,
      "maxScore": 10,
      "feedback": "feedback breve en español"
    }
  ],
  "strengths": ["..."],
  "improvements": ["..."],
  "coachingTips": ["consejo accionable 1", "consejo 2", "consejo 3"]
}

Reglas:
- score por criterio de 0 a 10
- overallScore es promedio ponderado * 10
- Si un criterio no aplica (ej. compartir pantalla sin evidencia), score 5 con feedback explicando
- coachingTips: 3-5 consejos concretos para la próxima práctica
- Todo en ${lang.nativeName}`;

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
