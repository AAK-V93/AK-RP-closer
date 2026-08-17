"use client";

import { useEffect, useState } from "react";
import {
  AgentState,
  BarVisualizer,
  useLocalParticipant,
  useTrackVolume,
  useVoiceAssistant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Phone, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

type TranscriptEntry = {
  role: "closer" | "prospect";
  text: string;
};

interface CallSessionViewProps {
  agentState: AgentState;
  transcriptions: TranscriptEntry[];
  prospectName: string;
  isActive: boolean;
  isConnecting?: boolean;
}

const STATE_LABELS: Record<string, string> = {
  disconnected: "Desconectado",
  connecting: "Conectando…",
  initializing: "El prospecto está entrando…",
  listening: "En silencio — te espera",
  thinking: "Prospecto pensando…",
  speaking: "Prospecto hablando",
};

export function CallSessionView({
  agentState,
  transcriptions,
  prospectName,
  isActive,
  isConnecting = false,
}: CallSessionViewProps) {
  const { audioTrack } = useVoiceAssistant();
  const volume = useTrackVolume(audioTrack);
  const { localParticipant, microphoneTrack } = useLocalParticipant();
  const localVolume = useTrackVolume(
    microphoneTrack
      ? {
          participant: localParticipant,
          publication: microphoneTrack,
          source: Track.Source.Microphone,
        }
      : undefined,
  );
  const [heardCloser, setHeardCloser] = useState(false);

  const closerHasSpoken =
    heardCloser ||
    transcriptions.some((entry) => entry.role === "closer" && entry.text.trim());

  useEffect(() => {
    if (!isActive) {
      setHeardCloser(false);
      return;
    }
    if (localVolume > 0.08) {
      setHeardCloser(true);
    }
  }, [isActive, localVolume]);

  const showHabla = isActive && !closerHasSpoken && agentState !== "speaking";
  const stateLabel = isConnecting
    ? "Conectando con el prospecto…"
    : (STATE_LABELS[agentState] ?? agentState);
  const isSpeaking = agentState === "speaking" || volume > 0.05;

  if (showHabla) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full max-w-2xl mx-auto gap-5 px-4 py-6">
        <div className="relative flex h-28 w-28 items-center justify-center rounded-full border-4 border-primary bg-primary/15">
          <span className="absolute inset-0 rounded-full animate-ping border-2 border-primary/40" />
          <Mic className="relative h-12 w-12 text-primary" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-5xl sm:text-6xl font-semibold tracking-tight text-fg1 animate-pulse">
            HABLA
          </p>
          <p className="text-sm text-fg2 max-w-xs mx-auto">
            {prospectName} ya está en la reunión, callado. Saluda y abre tú.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full max-w-2xl mx-auto gap-4 px-2">
      <div className="flex flex-col items-center gap-4 py-4">
        <div
          className={cn(
            "relative flex items-center justify-center w-24 h-24 rounded-full border-2 transition-all duration-300",
            isActive
              ? isSpeaking
                ? "border-primary bg-primary/10 shadow-[0_0_24px_rgba(var(--primary-rgb,99,102,241),0.25)]"
                : "border-separator1 bg-bg2"
              : isConnecting
                ? "border-primary/50 bg-primary/5"
                : "border-separator1 bg-bg2 opacity-60",
          )}
        >
          <Phone
            className={cn(
              "h-10 w-10 transition-colors",
              isSpeaking ? "text-primary" : "text-fg3",
            )}
          />
          {isActive && isSpeaking && (
            <span className="absolute inset-0 rounded-full animate-ping border border-primary/30" />
          )}
        </div>

        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-fg1">
            {isActive || isConnecting ? prospectName : "Prospecto simulado"}
          </p>
          <p className="text-xs text-fg3">
            {isActive || isConnecting ? stateLabel : "Listo para practicar"}
          </p>
        </div>

        {isConnecting && (
          <p className="text-sm text-fg2 text-center max-w-sm">
            En cuanto entre el lead vas a ver un HABLA grande. Ahí es tu turno.
          </p>
        )}

        {isActive && audioTrack && (
          <BarVisualizer
            className="h-8 w-48"
            state={agentState}
            barCount={5}
            trackRef={audioTrack}
          />
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-separator1 bg-bg0 overflow-hidden">
        <div className="px-4 py-2 border-b border-separator1 flex items-center gap-2">
          <Mic className="h-3.5 w-3.5 text-fg3" />
          <span className="text-xs font-semibold uppercase tracking-wider text-fg3">
            Transcripción en vivo
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[120px] max-h-[280px]">
          {transcriptions.length === 0 ? (
            <p className="text-sm text-fg3 text-center py-8">
              {isActive
                ? "La conversación aparecerá aquí…"
                : isConnecting
                  ? "Conectando…"
                  : "Entra a la reunión para ver la transcripción"}
            </p>
          ) : (
            transcriptions.map((entry, i) => (
              <div
                key={i}
                className={cn(
                  "text-sm rounded-lg px-3 py-2 max-w-[90%]",
                  entry.role === "prospect"
                    ? "bg-bg2 text-fg1 mr-auto"
                    : "bg-primary/10 text-fg1 ml-auto",
                )}
              >
                <span className="text-[10px] uppercase font-semibold text-fg3 block mb-0.5">
                  {entry.role === "prospect" ? prospectName : "Tú"}
                </span>
                {entry.text}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
