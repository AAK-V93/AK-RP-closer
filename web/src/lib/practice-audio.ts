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
