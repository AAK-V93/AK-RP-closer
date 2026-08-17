export interface CriterionScore {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  feedback: string;
}

export interface ProspectFile {
  pain: string;
  desire: string;
  urgency: string;
  quotes: string[];
  moneySignals: string;
  decisionContext: string;
}

export interface ObjectionAnalysis {
  quote: string;
  category: string;
  realRoot: string;
  howHandled: string;
  whyFailedOrWorked: string;
  suggestedLine: string;
}

export interface DiscoveryGap {
  whatWasMissed: string;
  howItFedObjection: string;
  suggestedQuestion: string;
}

export interface CallEvaluation {
  overallScore: number;
  outcomeSummary: string;
  criteria: CriterionScore[];
  prospectFile: ProspectFile | null;
  objections: ObjectionAnalysis[];
  discoveryGaps: DiscoveryGap[];
  strengths: string[];
  improvements: string[];
  coachingTips: string[];
  saved?: boolean;
  freePracticeUsed?: boolean;
}
