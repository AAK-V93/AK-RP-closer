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
        className="w-full md:w-auto flex justify-center"
      >
        {isChatRunning ? <SessionControls /> : <ConnectButton />}
      </motion.div>
    </AnimatePresence>
  );

  const showSession = isChatRunning || shouldConnect;

  return (
    <div className="relative flex flex-col h-full min-h-0 overflow-hidden min-w-0">
      <div className="shrink-0 px-3 pt-3 pb-1 md:px-4 md:pt-4">
        <ChatControls />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 lg:px-4">
        <div className="flex flex-col items-center min-w-0">
          {!isChatRunning && !evaluation && !shouldConnect && (
            <div className="text-center max-w-md px-2 mb-4 space-y-3">
              <h2 className="text-xl font-light">Tú abres la reunión</h2>
              <p className="text-sm text-fg2">
                El prospecto ya está en la llamada, en silencio. No te va a
                saludar primero. Cuando entres, habla tú.
              </p>
              <ol className="text-left text-sm text-fg2 space-y-1.5 mx-auto max-w-sm list-decimal list-inside">
                <li className="md:hidden">
                  Pulsa{" "}
                  <span className="font-medium text-fg1">Elegir oferta</span>{" "}
                  arriba, luego el botón de abajo.
                </li>
                <li className="hidden md:list-item">
                  Elige una oferta a la izquierda.
                </li>
                <li className="hidden md:list-item">
                  Pulsa{" "}
                  <span className="font-medium text-fg1">Entrar a la reunión</span>.
                </li>
                <li>
                  Permite el micrófono y saluda: quién eres y por qué se
                  reunieron.
                </li>
              </ol>
              {authStatus === "unauthenticated" && access && !access.used && (
                <p className="text-xs text-fg3">
                  Sin cuenta puedes hacer 1 práctica completa, con reporte, en
                  las tres ofertas listas.
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

          {shouldConnect && !isChatRunning && !evaluation && (
            <div className="text-center max-w-md px-4 mb-4 space-y-2">
              <h2 className="text-xl font-light">Conectando…</h2>
              <p className="text-sm text-fg2">
                En cuanto el prospecto esté listo vas a ver{" "}
                <span className="font-medium text-fg1">HABLA</span>. Ahí
                hablas tú. Si el navegador pide el micrófono, acepta.
              </p>
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

          {(evaluation || evalLoading) && (
            <div className="w-full max-w-2xl">
              <CallScorePanel
                evaluation={evaluation}
                isLoading={evalLoading}
                onClose={clearEvaluation}
              />
            </div>
          )}

          {!evaluation && !evalLoading && showSession && (
            <>
              {showBrief && (
                <div className="max-w-lg mx-auto w-full px-2 lg:hidden mb-2">
                  <ProspectBrief profile={training.prospectProfile} />
                </div>
              )}
              <div className="w-full min-w-0">
                <CallSessionView
                  agentState={state}
                  transcriptions={liveTranscript}
                  prospectName={training.prospectProfile.name}
                  isActive={isChatRunning}
                  isConnecting={shouldConnect && !isChatRunning}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-separator1 bg-bg1 px-3 py-3 md:px-4">
        {renderConnectionControl()}
      </div>
    </div>
  );
}
