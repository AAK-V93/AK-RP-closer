import { ModalitiesId } from "@/data/modalities";
import { ModelId } from "@/data/models";
import { VoiceId } from "@/data/voices";
import { LanguageCode } from "@/data/languages";
import type { LeadPlaybook, TalkStyle } from "@/lib/lead-playbook";
import type { TimeGoal } from "@/lib/call-timing";
import type { ReplayCall } from "@/lib/replay-call";

export type DifficultyLevel = "easy" | "medium" | "hard";

export type PracticeKind = "compose" | "replay";

export type QualificationLevel = "high" | "mixed" | "low";

export type CallSection =
  | "full"
  | "discovery"
  | "pitch"
  | "close"
  | "pitch_close";

export interface PreQualificationAnswers {
  mainGoal: string;
  currentSituation: string;
  timeline: string;
  budgetRange: string;
  decisionMaker: string;
}

export interface ProspectProfile {
  name: string;
  age: number;
  occupation: string;
  location: string;
  qualificationLevel: QualificationLevel;
  qualificationSummary: string;
  howTheyKnowTheOffer: string;
  preQualification: PreQualificationAnswers;
  pains: string[];
  urgency: string;
  desire: string;
  pastAttempts: string;
  partnerSituation: string;
  moneySituation: string;
  timeSituation: string;
  objections: string[];
  personalityNotes: string;
  /** The one objection this round will actually hold. */
  heldObjection?: string;
  /** True only when practicing a named real lead. */
  isRealLead?: boolean;
  talkStyle?: TalkStyle;
  leadTypeName?: string;
  noiseTopics?: string[];
  heldRelevant?: string[];
}

export interface TrainingSessionConfig {
  offerId?: string;
  productName: string;
  productDescription: string;
  difficulty: DifficultyLevel;
  callSection: CallSection;
  language: LanguageCode;
  /** Required when practicing close-only without pitch_close */
  pitchSummary?: string;
  /** Coach-directed objective or real lead name */
  practiceFocus?: string;
  practiceKind?: PracticeKind;
  replayCall?: ReplayCall | null;
  timeGoal?: TimeGoal;
  prospectProfile: ProspectProfile;
  leadPlaybook?: LeadPlaybook | null;
}

export interface TrainingState {
  training: TrainingSessionConfig;
  sessionConfig: {
    model: ModelId;
    modalities: ModalitiesId;
    voice: VoiceId;
    temperature: number;
    maxOutputTokens: number | null;
  };
}

export const PRACTICE_KIND_LABELS: Record<PracticeKind, string> = {
  compose: "Lead nuevo de esta oferta",
  replay: "Recrear una que no cerró",
};

export const CALL_SECTION_LABELS: Record<CallSection, string> = {
  full: "Reunión completa",
  discovery: "Solo descubrimiento",
  pitch: "Solo pitch",
  close: "Solo cierre",
  pitch_close: "Pitch + cierre",
};

export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  easy: "Fácil — habla a su estilo y se le escapa lo útil",
  medium: "Medio — habla, pero lo importante hay que pescarlo",
  hard: "Difícil — puede hablar mucho, y guarda lo que cierra",
};

export const defaultTrainingSession: TrainingSessionConfig = {
  productName: "",
  productDescription: "",
  difficulty: "medium",
  callSection: "full",
  language: "es",
  pitchSummary: "",
  practiceFocus: "",
  practiceKind: "compose",
  replayCall: null,
  prospectProfile: {
    name: "María González",
    age: 34,
    occupation: "Emprendedora digital",
    location: "Ciudad de México",
    qualificationLevel: "mixed",
    qualificationSummary:
      "Mixta: hay interés y un hueco. Conoce el producto; hay que calificar.",
    howTheyKnowTheOffer:
      "Llenó un formulario y vio la página; sabe de qué va a grandes rasgos.",
    preQualification: {
      mainGoal: "Escalar mi negocio online",
      currentSituation: "Facturo pero estoy estancada",
      timeline: "Quiero resultados en 3-6 meses",
      budgetRange: "Dispuesta a invertir si veo valor",
      decisionMaker: "Decido yo, consulto a mi pareja",
    },
    pains: [],
    urgency: "",
    desire: "",
    pastAttempts: "",
    partnerSituation: "",
    moneySituation: "",
    timeSituation: "",
    objections: [],
    personalityNotes: "",
    heldObjection: "",
    isRealLead: false,
    talkStyle: "rambler",
    leadTypeName: "",
    noiseTopics: [],
    heldRelevant: [],
  },
};

export const defaultTrainingState: TrainingState = {
  training: defaultTrainingSession,
  sessionConfig: {
    model: ModelId.GEMINI_2_5_FLASH_NATIVE_AUDIO_PREVIEW_09_2025,
    modalities: ModalitiesId.AUDIO_ONLY,
    voice: VoiceId.PUCK,
    temperature: 0.8,
    maxOutputTokens: null,
  },
};
