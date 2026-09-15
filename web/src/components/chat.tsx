"use client";

import { useState, useEffect, useRef } from "react";
import { SessionControls } from "@/components/session-controls";
import { ConnectButton } from "./connect-button";
import { ConnectionState } from "livekit-client";
import { motion, AnimatePresence } from "framer-motion";
import {
  useConnectionState,
  useRemoteParticipants,
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
import { shouldShowProspectBrief } from "@/lib/prospect-prompt";
import { ProspectBrief } from "@/components/prospect-brief";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";
import { formatClock, hasTimeGoal } from "@/lib/call-timing";
import {
  isPrematurePractice,
  nextPracticeRetry,
} from "@/lib/practice-retry";

export function Chat() {
  const connectionState = useConnectionState();
  const { state } = useVoiceAssistant();
  const remotes = useRemoteParticipants();
  const [isChatRunning, setIsChatRunning] = useState(false);
  const { agent, displayTranscriptions } = useAgent();
  const agentInRoom = Boolean(agent) || remotes.length > 0;
  const { disconnect, shouldConnect, connect } = useConnection();
  const { trainingState, dispatch } = useTraining();
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
  const startedAtRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [earlyExit, setEarlyExit] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [dismissedRetry, setDismissedRetry] = useState(false);

  useEffect(() => {
    if (shouldConnect) {
      const origin = startedAtRef.current || Date.now();
      transcriptRef.current = displayTranscriptions
        .filter((t) => t.segment.text?.trim())
        .map((t) => ({
          role: (t.participant?.isAgent ? "prospect" : "closer") as
            | "prospect"
            | "closer",
          text: t.segment.text.trim(),
          t: Math.max(
            0,
            ((t.segment.firstReceivedTime ?? origin) - origin) / 1000,
          ),
        }));
    }
  }, [displayTranscriptions, shouldConnect]);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      setIsChatRunning(false);
      return;
    }

    if (agentInRoom) {
      setHasSeenAgent(true);
      setIsChatRunning(true);
      return;
    }

    const waitMs = hasSeenAgent ? 20_000 : 45_000;
    const timer = window.setTimeout(() => {
      disconnect();
      setHasSeenAgent(false);
      toast({
        title: hasSeenAgent ? "Sesión interrumpida" : "El prospecto tarda en entrar",
        description: hasSeenAgent
          ? "El prospecto simulado se desconectó."
          : "Intenta de nuevo. En el celular a veces tarda en asignarse el agente.",
        variant: "destructive",
      });
    }, waitMs);

    setIsChatRunning(hasSeenAgent);

    return () => window.clearTimeout(timer);
  }, [connectionState, agentInRoom, hasSeenAgent, disconnect]);

  useEffect(() => {
    if (!shouldConnect) return;
    if (!startedAtRef.current) startedAtRef.current = Date.now();
    const tick = window.setInterval(() => {
      const next = Math.floor((Date.now() - (startedAtRef.current || Date.now())) / 1000);
      elapsedRef.current = next;
      setElapsedSec(next);
    }, 250);
    return () => window.clearInterval(tick);
  }, [shouldConnect]);

  // Evaluate when call ends — skip colgadas prematuras so they don't ensucian el ciclo coach.
  useEffect(() => {
    if (wasConnectedRef.current && !shouldConnect) {
      const transcript = transcriptRef.current;
      const durationSec = elapsedRef.current;
      if (isPrematurePractice(transcript, durationSec)) {
        setEarlyExit(true);
        clearEvaluation();
      } else {
        setEarlyExit(false);
        setDismissedRetry(false);
        evaluateCall(transcript, {
          callSection: trainingState.training.callSection,
          productName: trainingState.training.productName,
          difficulty: trainingState.training.difficulty,
          language: trainingState.training.language,
          prospectProfile: trainingState.training.prospectProfile,
          pitchSummary: trainingState.training.pitchSummary,
          durationSec,
          timeGoal: trainingState.training.timeGoal,
        });
      }
      startedAtRef.current = null;
    }
    if (!wasConnectedRef.current && shouldConnect) {
      startedAtRef.current = Date.now();
      elapsedRef.current = 0;
      setElapsedSec(0);
      setEarlyExit(false);
    }
    wasConnectedRef.current = shouldConnect;
  }, [shouldConnect, evaluateCall, clearEvaluation, trainingState.training]);

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
  const retry =
    evaluation && !evalLoading && !dismissedRetry
      ? nextPracticeRetry(evaluation, training.callSection)
      : null;

  const startAgain = async () => {
    setRetrying(true);
    try {
      await connect();
    } catch (error) {
      toast({
        title: "No se pudo entrar otra vez",
        description:
          error instanceof Error ? error.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setRetrying(false);
    }
  };

  const handleRetryFailedMoment = async () => {
    if (!evaluation || !retry) return;
    dispatch({
      type: "SET_TRAINING",
      payload: {
        practiceFocus: retry.focus,
        callSection: retry.callSection,
        prospectProfile: training.prospectProfile,
      },
    });
    clearEvaluation();
    await startAgain();
  };
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
          {!isChatRunning && !evaluation && !shouldConnect && !earlyExit && (
            <div className="text-center max-w-md px-2 mb-4 space-y-3">
              <h2 className="text-xl font-light">Tú abres la reunión</h2>
              <p className="text-sm text-fg2">
                El prospecto ya está en la llamada, en silencio. No te va a
                saludar primero. Cuando entres, habla tú.
              </p>
              <ol className="text-left text-sm text-fg2 space-y-1.5 mx-auto max-w-sm list-decimal list-inside">
                <li className="md:hidden">
                  Confirma tu oferta (la que subiste) y pulsa el botón de abajo.
                </li>
                <li className="hidden md:list-item">
                  A la izquierda está tu oferta. El lead emula a tus llamadas reales.
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
              {authStatus === "unauthenticated" && (
                <p className="text-xs text-fg3">
                  Entra, guarda tu oferta y sube llamadas. El agente de voz
                  practica contra <em>tus</em> leads.
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
              <Badge variant="secondary" className="font-mono tabular-nums">
                {formatClock(elapsedSec)}
                {hasTimeGoal(training.timeGoal) && training.timeGoal?.totalMin
                  ? ` / ${training.timeGoal.totalMin}m`
                  : ""}
              </Badge>
              {training.prospectProfile.leadTypeName && (
                <Badge variant="outline">{training.prospectProfile.leadTypeName}</Badge>
              )}
              <Badge variant="secondary">
                {training.practiceKind === "replay"
                  ? `Recreando ${training.replayCall?.leadName || training.prospectProfile.name}`
                  : "Lead nuevo"}
              </Badge>
              <Badge variant="outline">{training.productName}</Badge>
              <Badge variant="outline">
                {CALL_SECTION_LABELS[training.callSection]}
              </Badge>
              <Badge variant="outline">
                {DIFFICULTY_LABELS[training.difficulty]}
              </Badge>
            </div>
          )}

          {earlyExit && !shouldConnect && !evaluation && (
            <div className="w-full max-w-lg rounded-2xl border border-separator1 bg-bg1 p-5 space-y-3 mb-4">
              <h2 className="text-xl font-light">Saliste antes</h2>
              <p className="text-sm text-fg2">
                Este round no se evalúa ni se guarda. Así el coach no se llena
                de prácticas a medias.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={retrying}
                  onClick={() => {
                    setEarlyExit(false);
                    void startAgain();
                  }}
                >
                  {retrying ? "Entrando…" : "Seguir desde aquí"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEarlyExit(false)}
                >
                  Descartar
                </Button>
              </div>
            </div>
          )}

          {(evaluation || evalLoading) && (
            <div className="w-full max-w-2xl space-y-3">
              {retry && evaluation && !evalLoading && (
                <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <p className="text-sm font-medium">{retry.question}</p>
                  <p className="text-xs text-fg3">
                    Arranca en{" "}
                    {CALL_SECTION_LABELS[retry.callSection].toLowerCase()}:{" "}
                    {retry.focus}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      disabled={retrying}
                      onClick={() => void handleRetryFailedMoment()}
                    >
                      {retrying ? "Entrando…" : "Sí, practicamos esto"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setDismissedRetry(true)}
                    >
                      Ahora no
                    </Button>
                  </div>
                </div>
              )}
              <CallScorePanel
                evaluation={evaluation}
                isLoading={evalLoading}
                onClose={clearEvaluation}
                onDeleted={clearEvaluation}
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
                  elapsedSec={elapsedSec}
                  goalMin={training.timeGoal?.totalMin || null}
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
