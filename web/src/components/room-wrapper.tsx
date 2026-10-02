"use client";

import { useEffect } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useConnectionState,
  useLocalParticipant,
} from "@livekit/components-react";
import { ConnectionState, LocalAudioTrack, Track } from "livekit-client";
import { useConnection } from "@/hooks/use-connection";
import { AgentProvider } from "@/hooks/use-agent";
import { createSyntheticMicTrack } from "@/lib/practice-audio";
import { ReactNode } from "react";

function QaMicPublisher() {
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) return;
    const synthetic = createSyntheticMicTrack();
    const track = new LocalAudioTrack(synthetic.track, undefined, true);
    void localParticipant.publishTrack(track, { source: Track.Source.Microphone });
    return () => {
      void localParticipant.unpublishTrack(track);
      synthetic.stop();
    };
  }, [connectionState, localParticipant]);
  return null;
}

export function RoomWrapper({ children }: { children: ReactNode }) {
  const { shouldConnect, wsUrl, token, qaMode } = useConnection();

  return (
    <LiveKitRoom
      serverUrl={wsUrl}
      token={token}
      connect={shouldConnect}
      audio={
        qaMode
          ? false
          : {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
      }
      className="flex w-full h-full min-h-0"
      options={{
        publishDefaults: {
          stopMicTrackOnMute: false,
        },
      }}
    >
      <AgentProvider>
        {qaMode && <QaMicPublisher />}
        {children}
        <RoomAudioRenderer />
        <StartAudio
          label="Toca para oír al prospecto"
          className="fixed inset-x-4 bottom-28 z-50 rounded-xl bg-fgAccent1 px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg md:bottom-8"
        />
      </AgentProvider>
    </LiveKitRoom>
  );
}

