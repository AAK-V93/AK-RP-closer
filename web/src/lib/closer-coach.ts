import { CallEvaluation, CriterionScore } from "@/data/evaluation";
import type { QcCallReport } from "@/data/qc-report";

export type CoachNotes = {
  level: number;
  niche: string;
  strengths: string[];
  weaknesses: string[];
  recurringErrors: string[];
  nextSkill: string;
  recommendedExercise: string;
  lastSessionSummary: string;
  transferReady: boolean;
};

export const defaultCoachNotes = (): CoachNotes => ({
  level: 1,
  niche: "b2b-agencies-dfy",
  strengths: [],
  weaknesses: [],
  recurringErrors: [],
  nextSkill: "Diagnóstico inicial y fundamentos de comunicación",
  recommendedExercise: "",
  lastSessionSummary: "",
  transferReady: false,
});

export function mergeCoachNotes(
  current: CoachNotes,
  incoming: Partial<CoachNotes> | null | undefined,
): CoachNotes {
  if (!incoming || typeof incoming !== "object") return current;
  return {
    level: clampLevel(incoming.level ?? current.level),
    niche: String(incoming.niche || current.niche).slice(0, 80),
    strengths: asStringList(incoming.strengths, current.strengths),
    weaknesses: asStringList(incoming.weaknesses, current.weaknesses),
    recurringErrors: asStringList(incoming.recurringErrors, current.recurringErrors),
    nextSkill: String(incoming.nextSkill || current.nextSkill).slice(0, 280),
    recommendedExercise: String(
      incoming.recommendedExercise ?? current.recommendedExercise,
    ).slice(0, 600),
    lastSessionSummary: String(
      incoming.lastSessionSummary ?? current.lastSessionSummary,
    ).slice(0, 800),
    transferReady: Boolean(
      incoming.transferReady ?? current.transferReady,
    ),
  };
}

function clampLevel(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function asStringList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback.slice(0, 8);
  const next = value
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 2)
    .slice(0, 8);
  return next.length ? next : fallback.slice(0, 8);
}

export function parseStoredNotes(raw: unknown): CoachNotes {
  return mergeCoachNotes(defaultCoachNotes(), (raw || {}) as Partial<CoachNotes>);
}

export const COACH_THREAD_SECTION = "coach_thread";

export type CoachChatLine = {
  id: string;
  role: "user" | "coach";
  content: string;
  createdAt: string;
};

export type CoachThreadPayload = {
  kind: "coach_thread";
  notes: CoachNotes;
  messages: CoachChatLine[];
};

export function isCoachThreadSection(section: string) {
  return section === COACH_THREAD_SECTION;
}

export function parseCoachThread(evaluation: unknown): CoachThreadPayload {
  const raw = (evaluation || {}) as Partial<CoachThreadPayload> & {
    notes?: unknown;
    messages?: unknown;
  };
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map((item) => {
          const row = (item || {}) as Partial<CoachChatLine>;
          const role = row.role === "user" ? "user" : "coach";
          const content = String(row.content || "").trim();
          if (!content) return null;
          return {
            id: String(row.id || `msg-${Date.now()}`),
            role,
            content,
            createdAt: String(row.createdAt || new Date().toISOString()),
          } satisfies CoachChatLine;
        })
        .filter((item): item is CoachChatLine => Boolean(item))
        .slice(-80)
    : [];
  return {
    kind: "coach_thread",
    notes: parseStoredNotes(raw.notes),
    messages,
  };
}

type SessionRow = {
  id: string;
  createdAt: Date;
  productName: string;
  callSection: string;
  difficulty: string;
  overallScore: number;
  outcomeSummary: string;
  scored: boolean;
  evaluation: unknown;
  criterionScores: unknown;
};

export function compactTrainingEvidence(rows: SessionRow[], limit = 16) {
  return rows
    .filter((row) => !isCoachThreadSection(row.callSection))
    .slice(0, limit)
    .map((row) => {
    if (row.callSection === "qc_transcript") {
      const report = (row.evaluation || {}) as Partial<QcCallReport>;
      return {
        fuente: "llamada_real",
        id: row.id,
        fecha: row.createdAt.toISOString(),
        oferta: row.productName,
        score: row.overallScore,
        headline: report.headline || row.outcomeSummary,
        sold: report.sold ?? null,
        discovery: report.discovery?.blockScore ?? null,
        pitch: report.pitch?.blockScore ?? null,
        objeciones: (report.objections || []).slice(0, 4).map((o) => ({
          titulo: o.title,
          raiz: o.realRoot,
          porQueFallo: o.whyFailedOrWorked,
        })),
        fallasDiscovery: (report.discoveryFailures || []).slice(0, 3).map((f) => ({
          queSePerdio: f.whatWasMissed,
          comoAlimento: f.howItFedObjection,
        })),
        palancas: (report.verdictLevers || []).slice(0, 3),
      };
    }

    const evaluation = (row.evaluation || {}) as Partial<CallEvaluation>;
    const scores = (row.criterionScores as CriterionScore[]) || [];
    return {
      fuente: "practica_bot",
      id: row.id,
      fecha: row.createdAt.toISOString(),
      oferta: row.productName,
      seccion: row.callSection,
      dificultad: row.difficulty,
      score: row.scored ? row.overallScore : null,
      evaluada: row.scored,
      resultado: row.outcomeSummary,
      criteriosBajos: scores
        .filter((c) => typeof c.score === "number" && c.score < 6)
        .slice(0, 5)
        .map((c) => ({
          criterio: c.label || c.id,
          score: c.score,
          feedback: (c.feedback || "").slice(0, 180),
        })),
      fortalezas: (evaluation.strengths || []).slice(0, 3),
      debilidades: (evaluation.improvements || []).slice(0, 4),
      objeciones: (evaluation.objections || []).slice(0, 3).map((o) => ({
        categoria: o.category,
        raiz: o.realRoot,
        porQueFallo: o.whyFailedOrWorked,
      })),
      huecosDiscovery: (evaluation.discoveryGaps || []).slice(0, 3).map((g) => ({
        queSePerdio: g.whatWasMissed,
        comoAlimento: g.howItFedObjection,
      })),
      tips: (evaluation.coachingTips || []).slice(0, 3),
    };
  });
}
