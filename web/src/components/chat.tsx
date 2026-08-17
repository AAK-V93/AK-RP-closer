"use client";

import { useState, useEffect, useRef } from "react";
import { SessionControls } from "@/components/session-controls";
import { ConnectButton } from "./connect-button";
import { ConnectionState } from "livekit-client";
import { motion, AnimatePresence } from "framer-motion";
import {
  useConnectionState,
  useVoiceAssistant,
} from "@livekit/components-react";
import { ChatControls } from "@/components/chat-controls";
import { useAgent } from "@/hooks/use-agent";
import { useConnection } from "@/hooks/use-connection";
import { useCallEvaluation, TranscriptLine } from "@/hooks/use-call-evaluation";
import { toast } from "@/hooks/use-toast";
import { CallSessionView } from "@/components/call-session-view";
import { CallScorePanel } from "@/components/call-score-panel";
import { useTraining } from "@/hooks/use-training-state";
import {
  CALL_SECTION_LABELS,
  DIFFICULTY_LABELS,
} from "@/data/training-session";
import { LANGUAGE_LABELS } from "@/data/languages";
import { shouldShowProspectBrief } from "@/lib/prospect-prompt";
import { ProspectBrief } from "@/components/prospect-brief";
import { Badge } from "@/components/ui/badge";
import { usePracticeAccess } from "@/hooks/use-practice-access";
import { useSession } from "next-auth/react";

export function Chat() {
  const connectionState = useConnectionState();
  const { state } = useVoiceAssistant();
  const [isChatRunning, setIsChatRunning] = useState(false);
  const { agent, displayTranscriptions } = useAgent();
  const { disconnect, shouldConnect } = useConnection();
  const { trainingState } = useTraining();
  const { access, refresh: refreshAccess } = usePracticeAccess();
  const { status: authStatus } = useSession();
  const {
    evaluation,
    isLoading: evalLoading,
    error: evalError,
    evaluateCall,
    clearEvaluation,
  } = useCallEvaluation();
  const [hasSeenAgent, setHasSeenAgent] = useState(false);
  const wasConnectedRef = useRef(false);
  const transcriptRef = useRef<TranscriptLine[]>([]);

  useEffect(() => {
    if (shouldConnect) {
      transcriptRef.current = displayTranscriptions
        .filter((t) => t.segment.text?.trim())
        .map((t) => ({
          role: (t.participant?.isAgent ? "prospect" : "closer") as
            | "prospect"
            | "closer",
          text: t.segment.text.trim(),
        }));
    }
  }, [displayTranscriptions, shouldConnect]);

  useEffect(() => {
    let disconnectTimer: NodeJS.Timeout | undefined;
    let appearanceTimer: NodeJS.Timeout | undefined;

    if (connectionState === ConnectionState.Connected && !agent) {
      appearanceTimer = setTimeout(() => {
        disconnect();
        setHasSeenAgent(false);
        toast({
          title: "Agente no disponible",
          description: "No se pudo conectar al simulador. Verifica que el agent esté corriendo.",
          variant: "destructive",
        });
      }, 5000);
    }

    if (agent) {
      setHasSeenAgent(true);
    }

    if (
      connectionState === ConnectionState.Connected &&
      !agent &&
      hasSeenAgent
    ) {
      disconnectTimer = setTimeout(() => {
        if (!agent) {
          disconnect();
          setHasSeenAgent(false);
        }
        toast({
          title: "Sesión interrumpida",
          description: "El prospecto simulado se desconectó.",
          variant: "destructive",
        });
      }, 5000);
    }

    setIsChatRunning(
      connectionState === ConnectionState.Connected && hasSeenAgent,
    );

    return () => {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      if (appearanceTimer) clearTimeout(appearanceTimer);
    };
  }, [connectionState, agent, disconnect, hasSeenAgent]);

  // Evaluate when call ends
  useEffect(() => {
    if (wasConnectedRef.current && !shouldConnect) {
      evaluateCall(transcriptRef.current, {
        callSection: trainingState.training.callSection,
        productName: trainingState.training.productName,
        difficulty: trainingState.training.difficulty,
        language: trainingState.training.language,
        prospectProfile: trainingState.training.prospectProfile,
        pitchSummary: trainingState.training.pitchSummary,
      });
    }
    wasConnectedRef.current = shouldConnect;
  }, [shouldConnect, evaluateCall, trainingState.training]);

  useEffect(() => {
    if (evaluation?.freePracticeUsed) {
      void refreshAccess();
    }
  }, [evaluation?.freePracticeUsed, refreshAccess]);

  useEffect(() => {
    if (evalError) {
      toast({
        title: "Evaluación",
        description: evalError,
        variant: "destructive",
      });
    }
  }, [evalError]);

  const { training } = trainingState;
  const showBrief =
    isChatRunning && shouldShowProspectBrief(training.callSection);

  const liveTranscript = displayTranscriptions
    .filter((t) => t.segment.text?.trim())
    .map((t) => ({
      role: (t.participant?.isAgent ? "prospect" : "closer") as
        | "prospect"
        | "closer",
      text: t.segment.text.trim(),
    }));

  const renderConnectionControl = () => (
    <AnimatePresence mode="wait">
      <motion.div
        key={isChatRunning ? "session-controls" : "connect-button"}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ type: "tween", duration: 0.15, ease: "easeInOut" }}
      >
        {isChatRunning ? <SessionControls /> : <ConnectButton />}
      </motion.div>
    </AnimatePresence>
  );

  return (
    <div className="relative flex flex-col h-full overflow-hidden p-2 lg:p-4 min-w-0">
      <ChatControls />

      <div className="flex flex-col flex-grow items-center lg:justify-between mt-8 lg:mt-0 min-w-0">
        {!isChatRunning && !evaluation && (
          <div className="text-center max-w-md px-4 mb-4 space-y-2">
            <h2 className="text-xl font-light">Práctica de cierre</h2>
            <p className="text-sm text-fg3">
              El lead espera a que tú abras la reunión. Agendó esta cita y ya
              sabe el contexto. No va a saludar primero.
            </p>
            {authStatus === "unauthenticated" && access && !access.used && (
              <p className="text-xs text-fg3">
                Sin cuenta puedes hacer 1 práctica completa, con reporte.
              </p>
            )}
            {authStatus === "unauthenticated" && access?.used && (
              <p className="text-xs text-fg3">
                Ya usaste tu práctica gratis. Crea una cuenta para volver a
                practicar.
              </p>
            )}
          </div>
        )}

        {isChatRunning && (
          <div className="flex flex-wrap gap-2 justify-center mb-2">
            <Badge variant="secondary">{training.productName}</Badge>
            <Badge variant="outline">
              {CALL_SECTION_LABELS[training.callSection]}
            </Badge>
            <Badge variant="outline">
              {DIFFICULTY_LABELS[training.difficulty]}
            </Badge>
            <Badge variant="outline">
              {LANGUAGE_LABELS[training.language]}
            </Badge>
          </div>
        )}

        <div className="w-full h-full flex flex-col min-w-0 gap-4 flex-1">
          {(evaluation || evalLoading) && (
            <CallScorePanel
              evaluation={evaluation}
              isLoading={evalLoading}
              onClose={clearEvaluation}
            />
          )}

          {!evaluation && !evalLoading && (
            <>
              {showBrief && (
                <div className="max-w-lg mx-auto w-full px-2 lg:hidden">
                  <ProspectBrief profile={training.prospectProfile} />
                </div>
              )}

              <div className="grow h-full flex items-center justify-center min-w-0 w-full">
                <CallSessionView
                  agentState={state}
                  transcriptions={liveTranscript}
                  prospectName={training.prospectProfile.name}
                  isActive={isChatRunning}
                />
              </div>
            </>
          )}
        </div>

        <div className="my-4">{renderConnectionControl()}</div>
      </div>
    </div>
  );
}
