"use client";

import React, {
  createContext,
  useReducer,
  useContext,
  ReactNode,
  Dispatch,
} from "react";
import {
  TrainingState,
  TrainingSessionConfig,
  defaultTrainingState,
  defaultTrainingSession,
} from "@/data/training-session";
import { generateProspectProfile } from "@/lib/prospect-prompt";
import { trainingHelpers } from "@/lib/training-helpers";

type Action =
  | { type: "SET_TRAINING"; payload: Partial<TrainingSessionConfig> }
  | { type: "SET_SESSION_CONFIG"; payload: Partial<TrainingState["sessionConfig"]> }
  | { type: "REGENERATE_PROSPECT" }
  | { type: "RESET" };

function trainingReducer(state: TrainingState, action: Action): TrainingState {
  switch (action.type) {
    case "SET_TRAINING": {
      const nextTraining = { ...state.training, ...action.payload };
      const shouldRegenerate =
        action.payload.productName !== undefined ||
        action.payload.productDescription !== undefined ||
        action.payload.difficulty !== undefined ||
        action.payload.language !== undefined;

      if (
        shouldRegenerate &&
        nextTraining.productName.trim() &&
        nextTraining.productDescription.trim()
      ) {
        nextTraining.prospectProfile = generateProspectProfile(
          nextTraining.productName,
          nextTraining.productDescription,
          nextTraining.difficulty,
          nextTraining.language,
        );
      }

      return { ...state, training: nextTraining };
    }
    case "SET_SESSION_CONFIG":
      return {
        ...state,
        sessionConfig: { ...state.sessionConfig, ...action.payload },
      };
    case "REGENERATE_PROSPECT": {
      const { productName, productDescription, difficulty, language } =
        state.training;
      if (!productName.trim() || !productDescription.trim()) {
        return state;
      }
      return {
        ...state,
        training: {
          ...state.training,
          prospectProfile: generateProspectProfile(
            productName,
            productDescription,
            difficulty,
            language,
          ),
        },
      };
    }
    case "RESET":
      return defaultTrainingState;
    default:
      return state;
  }
}

interface TrainingContextProps {
  trainingState: TrainingState;
  dispatch: Dispatch<Action>;
  helpers: typeof trainingHelpers;
}

const TrainingContext = createContext<TrainingContextProps | undefined>(
  undefined,
);

export function TrainingProvider({ children }: { children: ReactNode }) {
  const [trainingState, dispatch] = useReducer(
    trainingReducer,
    defaultTrainingState,
  );

  return (
    <TrainingContext.Provider
      value={{ trainingState, dispatch, helpers: trainingHelpers }}
    >
      {children}
    </TrainingContext.Provider>
  );
}

export function useTraining() {
  const context = useContext(TrainingContext);
  if (!context) {
    throw new Error("useTraining must be used within TrainingProvider");
  }
  return context;
}

export { defaultTrainingSession };
