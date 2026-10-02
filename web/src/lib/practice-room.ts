type TrackPublication<T> = { track?: T | null };

export type PracticeRoom<T extends { stop?: () => void } = { stop?: () => void }> = {
  localParticipant: {
    trackPublications: Map<string, TrackPublication<T>> | Iterable<TrackPublication<T>>;
    unpublishTrack: (track: T, stopOnUnpublish?: boolean) => Promise<unknown>;
  };
  disconnect: (stopTracks?: boolean) => Promise<void>;
};

const leavingRooms = new WeakMap<object, Promise<void>>();
const leaveTokens = new WeakMap<object, number>();

/** A new connection cancels a disconnect that is still in flight. */
export function resetPracticeRoom(room: object) {
  leaveTokens.set(room, (leaveTokens.get(room) || 0) + 1);
  leavingRooms.delete(room);
}

function publicationsOf<T extends { stop?: () => void }>(room: PracticeRoom<T>): TrackPublication<T>[] {
  const pubs = room.localParticipant.trackPublications;
  if (pubs instanceof Map) return [...pubs.values()];
  return [...pubs];
}

/** Unpublish every local track, then disconnect. Overlapping calls share one run. */
export function leavePracticeRoom<T extends { stop?: () => void }>(room: PracticeRoom<T>) {
  const existing = leavingRooms.get(room);
  if (existing) return existing;
  const token = leaveTokens.get(room) || 0;
  const job = leaveOnce(room, token);
  leavingRooms.set(room, job);
  return job;
}

async function leaveOnce<T extends { stop?: () => void }>(room: PracticeRoom<T>, token: number) {
  if ((leaveTokens.get(room) || 0) !== token) return;
  for (const pub of publicationsOf(room)) {
    const track = pub?.track;
    if (!track) continue;
    try {
      await room.localParticipant.unpublishTrack(track, true);
    } catch {
      /* already unpublished */
    }
    try {
      track.stop?.();
    } catch {
      /* already stopped */
    }
  }
  if ((leaveTokens.get(room) || 0) !== token) return;
  try {
    await room.disconnect(true);
  } catch {
    /* already disconnected */
  }
}
