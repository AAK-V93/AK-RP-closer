import { ModalitiesId } from "@/data/modalities";
import { ModelId } from "@/data/models";
import { VoiceId } from "@/data/voices";
import { LanguageCode } from "@/data/languages";

export type DifficultyLevel = "easy" | "medium" | "hard";

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
}

export interface TrainingSessionConfig {
  productName: string;
  productDescription: string;
  difficulty: DifficultyLevel;
  callSection: CallSection;
  language: LanguageCode;
  /** Required when practicing close-only without pitch_close */
  pitchSummary?: string;
  prospectProfile: ProspectProfile;
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

export const CALL_SECTION_LABELS: Record<CallSection, string> = {
  full: "Llamada completa",
  discovery: "Solo descubrimiento",
  pitch: "Solo pitch",
  close: "Solo cierre",
  pitch_close: "Pitch + cierre",
};

export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  easy: "Fácil — colaborativo",
  medium: "Medio — algo resistente",
  hard: "Difícil — escéptico y exigente",
};

export const defaultTrainingSession: TrainingSessionConfig = {
  productName: "",
  productDescription: "",
  difficulty: "medium",
  callSection: "full",
  language: "es",
  pitchSummary: "",
  prospectProfile: {
    name: "María González",
    age: 34,
    occupation: "Emprendedora digital",
    location: "Ciudad de México",
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
