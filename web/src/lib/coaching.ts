import { CallEvaluation, CriterionScore } from "@/data/evaluation";
import { RUBRIC_CRITERIA } from "@/data/rubric";

export type WeakSkill = {
  id: string;
  label: string;
  avgScore: number;
  timesLow: number;
  lastFeedback: string;
};

export type RepeatedNote = {
  text: string;
  count: number;
};

export type RecentPractice = {
  id: string;
  createdAt: string;
  productName: string;
  callSection: string;
  overallScore: number;
  outcomeSummary: string;
  scored: boolean;
};

export type CoachingInsights = {
  practiceCount: number;
  avgScore: number;
  weakSkills: WeakSkill[];
  commonErrors: RepeatedNote[];
  suggestions: RepeatedNote[];
  recent: RecentPractice[];
};

function labelFor(id: string) {
  return RUBRIC_CRITERIA.find((c) => c.id === id)?.label ?? id;
}

function normalizeNote(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function bump(map: Map<string, { text: string; count: number }>, text: string) {
  const key = normalizeNote(text).slice(0, 160);
  if (key.length < 12) return;
  const prev = map.get(key);
  if (prev) prev.count += 1;
  else map.set(key, { text: text.trim(), count: 1 });
}

export function buildCoachingInsights(
  rows: {
    id: string;
    createdAt: Date;
    productName: string;
    callSection: string;
    overallScore: number;
    outcomeSummary: string;
    evaluation: unknown;
    criterionScores: unknown;
    scored?: boolean;
  }[],
): CoachingInsights {
  const skillTotals = new Map<
    string,
    { sum: number; n: number; low: number; feedback: string }
  >();
  const errors = new Map<string, { text: string; count: number }>();
  const tips = new Map<string, { text: string; count: number }>();

  for (const row of rows) {
    if (row.scored === false) continue;
    const scores = (row.criterionScores as CriterionScore[]) || [];
    for (const c of scores) {
      const cur = skillTotals.get(c.id) ?? {
        sum: 0,
        n: 0,
        low: 0,
        feedback: "",
      };
      cur.sum += c.score;
      cur.n += 1;
      if (c.score < 6) {
        cur.low += 1;
        cur.feedback = c.feedback || cur.feedback;
      }
      skillTotals.set(c.id, cur);
    }

    const evaluation = row.evaluation as CallEvaluation;
    for (const item of evaluation?.improvements ?? []) bump(errors, item);
    for (const gap of evaluation?.discoveryGaps ?? []) {
      if (gap.whatWasMissed) bump(errors, gap.whatWasMissed);
    }
    for (const obj of evaluation?.objections ?? []) {
      if (obj.whyFailedOrWorked) bump(errors, obj.whyFailedOrWorked);
    }
    for (const tip of evaluation?.coachingTips ?? []) bump(tips, tip);
    for (const obj of evaluation?.objections ?? []) {
      if (obj.suggestedLine) bump(tips, obj.suggestedLine);
    }
  }

  const weakSkills: WeakSkill[] = [...skillTotals.entries()]
    .map(([id, v]) => ({
      id,
      label: labelFor(id),
      avgScore: v.n ? v.sum / v.n : 0,
      timesLow: v.low,
      lastFeedback: v.feedback,
    }))
    .filter((s) => s.timesLow > 0 || s.avgScore < 7)
    .sort((a, b) => a.avgScore - b.avgScore || b.timesLow - a.timesLow)
    .slice(0, 6);

  const toList = (map: Map<string, { text: string; count: number }>) =>
    [...map.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

  const scoredRows = rows.filter((r) => r.scored !== false);
  const avgScore = scoredRows.length
    ? scoredRows.reduce((s, r) => s + r.overallScore, 0) / scoredRows.length
    : 0;

  return {
    practiceCount: scoredRows.length,
    avgScore,
    weakSkills,
    commonErrors: toList(errors),
    suggestions: toList(tips),
    recent: rows.slice(0, 12).map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      productName: r.productName,
      callSection: r.callSection,
      overallScore: r.overallScore,
      outcomeSummary: r.outcomeSummary,
      scored: r.scored !== false,
    })),
  };
}
