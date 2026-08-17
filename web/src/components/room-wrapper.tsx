"use client";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
} from "@livekit/components-react";
import { useConnection } from "@/hooks/use-connection";
import { AgentProvider } from "@/hooks/use-agent";
import { ReactNode } from "react";

export function RoomWrapper({ children }: { children: ReactNode }) {
  const { shouldConnect, wsUrl, token } = useConnection();

  return (
    <LiveKitRoom
      serverUrl={wsUrl}
      token={token}
      connect={shouldConnect}
      audio={{
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }}
      className="flex w-full h-full min-h-0"
      options={{
        publishDefaults: {
          stopMicTrackOnMute: false,
        },
      }}
    >
      <AgentProvider>
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

