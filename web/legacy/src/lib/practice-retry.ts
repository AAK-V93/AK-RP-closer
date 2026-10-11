import type { CallEvaluation, CriterionScore } from "@/data/evaluation";
import type { CallSection } from "@/data/training-session";

const DISCOVERY_IDS = new Set(["pain", "desire", "urgency"]);
const CLOSE_IDS = new Set([
  "aaa_acknowledge",
  "aaa_associate",
  "aaa_ask",
  "use_discovery",
]);

export type PracticeRetry = {
  question: string;
  focus: string;
  callSection: CallSection;
  criterionLabel: string;
};

export function isPrematurePractice(
  transcript: { role?: string; text?: string }[],
  durationSec: number,
) {
  const lines = transcript.filter((line) => String(line.text || "").trim());
  const closer = lines.filter((line) => line.role === "closer").length;
  const prospect = lines.filter((line) => line.role === "prospect").length;
  if (durationSec < 45) return true;
  if (lines.length < 4) return true;
  if (closer < 2 || prospect < 1) return true;
  return false;
}

function ratio(criterion: CriterionScore) {
  const max = criterion.maxScore || 10;
  return criterion.score / max;
}

function sectionForCriterion(
  criterionId: string,
  current: CallSection,
): CallSection {
  if (DISCOVERY_IDS.has(criterionId)) {
    if (current === "discovery") return "discovery";
    return "discovery";
  }
  if (CLOSE_IDS.has(criterionId)) {
    if (current === "pitch" || current === "pitch_close") return current;
    if (current === "close") return "close";
    return "close";
  }
  return current === "full" ? "full" : current;
}

export function nextPracticeRetry(
  evaluation: CallEvaluation,
  currentSection: CallSection,
): PracticeRetry | null {
  const ranked = [...(evaluation.criteria || [])].sort(
    (a, b) => ratio(a) - ratio(b),
  );
  const worst = ranked[0];
  const focus =
    evaluation.improvements?.[0] ||
    evaluation.coachingTips?.[0] ||
    worst?.feedback ||
    worst?.label ||
    "";
  if (!focus.trim()) return null;

  const callSection = worst
    ? sectionForCriterion(worst.id, currentSection)
    : currentSection === "full"
      ? "discovery"
      : currentSection;
  const criterionLabel = worst?.label || "ese momento";

  return {
    question: `Ahí se te fue ${criterionLabel.toLowerCase()}. ¿Practicamos esto otra vez?`,
    focus: focus.trim(),
    callSection,
    criterionLabel,
  };
}
