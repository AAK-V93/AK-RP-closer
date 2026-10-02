"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
} from "@livekit/components-react";
import { ConnectionState, LocalAudioTrack, Track } from "livekit-client";
import { useConnection } from "@/hooks/use-connection";
import { AgentProvider } from "@/hooks/use-agent";
import { createSyntheticMicTrack } from "@/lib/practice-audio";
import { abortPracticeNegotiation, leavePracticeRoom, resetPracticeRoom } from "@/lib/practice-room";

function RoomTeardown() {
  const room = useRoomContext();
  const { shouldConnect } = useConnection();
  const connectedOnce = useRef(false);
  useEffect(() => {
    if (shouldConnect) {
      connectedOnce.current = true;
      resetPracticeRoom(room);
      return;
    }
    if (!connectedOnce.current) return;
    void leavePracticeRoom(room);
  }, [room, shouldConnect]);
  useEffect(() => {
    return () => {
      if (!connectedOnce.current) return;
      void leavePracticeRoom(room);
    };
  }, [room]);
  return null;
}

function publishCleanup(
  room: ReturnType<typeof useRoomContext>,
  participant: ReturnType<typeof useLocalParticipant>["localParticipant"],
  track: LocalAudioTrack | null,
) {
  abortPracticeNegotiation(room);
  if (!track) return;
  const published = [...participant.trackPublications.values()].find(
    (pub) => pub.track === track && pub.trackSid,
  );
  if (published) {
    void participant.unpublishTrack(track, true);
    return;
  }
  track.stop();
}

function GuardedMicPublisher({ synthetic }: { synthetic: boolean }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  const { shouldConnect } = useConnection();
  const trackRef = useRef<LocalAudioTrack | null>(null);
  useEffect(() => {
    if (!shouldConnect || connectionState !== ConnectionState.Connected) return;
    let cancelled = false;
    const owned = synthetic ? createSyntheticMicTrack() : null;
    void (async () => {
      try {
        const media = owned
          ? owned.track
          : (
              await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
              })
            ).getAudioTracks()[0];
        if (!media || cancelled || !shouldConnect) {
          media?.stop();
          owned?.stop();
          return;
        }
        const track = new LocalAudioTrack(media, undefined, true);
        trackRef.current = track;
        if (cancelled) {
          track.stop();
          return;
        }
        await localParticipant.publishTrack(track, { source: Track.Source.Microphone });
      } catch {
        /* cancel or a missing mic closes the room without negotiating */
      }
    })();
    return () => {
      cancelled = true;
      const track = trackRef.current;
      trackRef.current = null;
      publishCleanup(room, localParticipant, track);
      owned?.stop();
    };
  }, [connectionState, localParticipant, room, shouldConnect, synthetic]);
  return null;
}

export function RoomWrapper({ children }: { children: ReactNode }) {
  const { shouldConnect, wsUrl, token, qaMode } = useConnection();

  return (
    <LiveKitRoom
      serverUrl={wsUrl}
      token={token}
      connect={shouldConnect}
      audio={false}
      className="flex w-full h-full min-h-0"
      options={{
        publishDefaults: {
          stopMicTrackOnMute: false,
        },
      }}
    >
      <AgentProvider>
        <RoomTeardown />
        <GuardedMicPublisher synthetic={qaMode} />
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

