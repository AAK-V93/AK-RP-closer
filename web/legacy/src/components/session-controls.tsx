"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Mic, MicOff, PhoneOff } from "lucide-react";
import { useEffect, useState } from "react";

import {
  TrackToggle,
  BarVisualizer,
  useLocalParticipant,
  useMediaDeviceSelect,
} from "@livekit/components-react";
import { useKrispNoiseFilter } from "@livekit/components-react/krisp";
import { Track } from "livekit-client";

import { useConnection } from "@/hooks/use-connection";
import { isHardwareMicTrack } from "@/lib/practice-audio";

export function SessionControls() {
  const localParticipant = useLocalParticipant();
  const deviceSelect = useMediaDeviceSelect({ kind: "audioinput" });
  const { disconnect, qaMode } = useConnection();

  const [isMuted, setIsMuted] = useState(localParticipant.isMicrophoneEnabled);
  const { isNoiseFilterEnabled, isNoiseFilterPending, setNoiseFilterEnabled } =
    useKrispNoiseFilter();
  const hardwareMic =
    !qaMode &&
    isHardwareMicTrack(localParticipant.microphoneTrack?.track?.mediaStreamTrack);
  useEffect(() => {
    if (!hardwareMic) return;
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if (mobile) return;
    void Promise.resolve(setNoiseFilterEnabled(true)).catch(() => undefined);
  }, [hardwareMic, setNoiseFilterEnabled]);
  useEffect(() => {
    setIsMuted(localParticipant.isMicrophoneEnabled === false);
  }, [localParticipant.isMicrophoneEnabled]);

  return (
    <div className="flex flex-row gap-2 w-full md:w-auto justify-center overflow-x-auto">
      <div className="flex items-center rounded-md bg-bg2 text-secondary-foreground overflow-hidden">
        <div className="flex items-center gap-2">
          <TrackToggle
            source={Track.Source.Microphone}
            className={`inline-flex h-11 min-h-11 min-w-11 items-center justify-center whitespace-nowrap rounded-l-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:!bg-bg3 hover:!rounded-l-md shadow-none !px-3 !border-r-[1px] !border-separator1 lg:h-9 lg:min-h-0 lg:min-w-0`}
            style={{ borderRightStyle: "solid" }}
            showIcon={false}
          >
            {isMuted ? (
              <MicOff className="text-fg3 h-4 w-4" />
            ) : (
              <Mic className="text-fg3 h-4 w-4" />
            )}
          </TrackToggle>
          <BarVisualizer
            className="!h-6 pl-2 pr-4"
            state="speaking"
            barCount={7}
            trackRef={{
              participant: localParticipant.localParticipant,
              publication: localParticipant.microphoneTrack,
              source: Track.Source.Microphone,
            }}
          >
          </BarVisualizer>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              className="h-11 w-11 bg-bg2 shadow-none hover:bg-bg3 rounded-l-none rounded-r-md border-l-[1px] border-separator1 px-0 text-sm font-semibold lg:h-9 lg:w-9"
            >
              <ChevronDown className="h-4 w-4 text-fg3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            alignOffset={-5}
            className="w-[320px]"
            forceMount
          >
            <DropdownMenuLabel className="text-xs uppercase tracking-widest">
              Available inputs
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {deviceSelect.devices.map((device, index) => (
              <DropdownMenuCheckboxItem
                key={`device-${index}`}
                className="text-xs"
                checked={device.deviceId === deviceSelect.activeDeviceId}
                onCheckedChange={() =>
                  deviceSelect.setActiveMediaDevice(device.deviceId)
                }
              >
                {device.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs uppercase tracking-widest">
              Audio Settings
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              className="text-xs"
              checked={isNoiseFilterEnabled}
              onCheckedChange={async (checked) => {
                if (!hardwareMic) return;
                try {
                  await setNoiseFilterEnabled(checked);
                } catch {
                  /* OverconstrainedError when the track cannot take the Krisp constraints */
                }
              }}
              disabled={isNoiseFilterPending || !hardwareMic}
            >
              Enhanced Noise Filter
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button variant="destructive" onClick={disconnect} className="h-11 lg:h-9">
        <PhoneOff className="h-4 w-4" />
        Terminar y evaluar
      </Button>
    </div>
  );
}
