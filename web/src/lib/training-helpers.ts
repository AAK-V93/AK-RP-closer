import {
  CallSection,
  TrainingSessionConfig,
  TrainingState,
} from "@/data/training-session";
import { buildProspectInstructions } from "@/lib/prospect-prompt";

export interface TokenRequestPayload {
  training: TrainingSessionConfig;
  sessionConfig: TrainingState["sessionConfig"];
}

export const trainingHelpers = {
  buildInstructions(training: TrainingSessionConfig): string {
    return buildProspectInstructions(training);
  },

  toTokenPayload(state: TrainingState): TokenRequestPayload {
    return {
      training: state.training,
      sessionConfig: state.sessionConfig,
    };
  },

  validateTraining(training: TrainingSessionConfig): string | null {
    if (!training.productName.trim()) {
      return "Ingresa el nombre del producto que vendes";
    }
    if (!training.productDescription.trim()) {
      return "Describe brevemente tu producto o programa";
    }
    if (
      training.callSection === "close" &&
      !training.pitchSummary?.trim()
    ) {
      return "Para practicar solo cierre, pega o escribe el resumen del pitch";
    }
    return null;
  },

  getApplicableRubricIds(section: CallSection): string[] {
    const map: Record<CallSection, string[]> = {
      full: Array.from({ length: 23 }, (_, i) => `p${i + 1}`),
      discovery: Array.from({ length: 10 }, (_, i) => `p${i + 1}`),
      pitch: Array.from({ length: 9 }, (_, i) => `p${i + 11}`),
      close: ["p20", "p21", "p22", "p23"],
      pitch_close: [
        ...Array.from({ length: 9 }, (_, i) => `p${i + 11}`),
        "p20",
        "p21",
        "p22",
        "p23",
      ],
    };
    return map[section];
  },
};
