/** A getUserMedia mic has a device id. Synthetic and empty tracks do not. */
export function isHardwareMicTrack(
  track: { getSettings?: () => MediaTrackSettings; label?: string } | null | undefined,
) {
  if (!track) return false;
  const settings = track.getSettings?.();
  if (settings?.deviceId) return true;
  const label = (track.label || "").trim();
  if (!label) return false;
  return !/synthetic|destination|audioctx/i.test(label);
}

/** Quiet tone so Práctica can connect when QA has no microphone. */
export function createSyntheticMicTrack() {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.value = 0.001;
  const destination = context.createMediaStreamDestination();
  oscillator.frequency.value = 220;
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start();
  const track = destination.stream.getAudioTracks()[0];
  return {
    track,
    stop() {
      try {
        track.stop();
        oscillator.stop();
      } catch {
        /* already stopped */
      }
      void context.close();
    },
  };
}
