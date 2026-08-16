"use client";

import { useCallback, useState } from "react";
import { CallEvaluation } from "@/data/evaluation";
import { ProspectProfile } from "@/data/training-session";

export type TranscriptLine = {
  role: "closer" | "prospect";
  text: string;
};

export function useCallEvaluation() {
  const [evaluation, setEvaluation] = useState<CallEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evaluateCall = useCallback(
    async (
      transcript: TranscriptLine[],
      meta: {
        callSection: string;
        productName: string;
        difficulty: string;
        language: string;
        prospectProfile?: ProspectProfile;
        pitchSummary?: string;
      },
    ) => {
      if (transcript.length < 2) {
        setError(
          "La llamada fue muy corta para evaluar. Intenta una práctica más larga.",
        );
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript,
            callSection: meta.callSection,
            productName: meta.productName,
            difficulty: meta.difficulty,
            language: meta.language,
            prospectProfile: meta.prospectProfile,
            pitchSummary: meta.pitchSummary,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Evaluation failed");
        }

        const data: CallEvaluation = await response.json();
        setEvaluation(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al evaluar");
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const clearEvaluation = useCallback(() => {
    setEvaluation(null);
    setError(null);
  }, []);

  return {
    evaluation,
    isLoading,
    error,
    evaluateCall,
    clearEvaluation,
  };
}
