type TrackPublication<T> = { track?: T | null; trackSid?: string };

type OfferPublisher = {
  _pc?: { signalingState?: string } | null;
  createAndSendOffer?: (options?: unknown) => Promise<unknown>;
  __offerGuarded?: boolean;
  __closeOffers?: () => void;
};

export type PracticeRoom<T extends { stop?: () => void } = { stop?: () => void }> = {
  state?: string;
  localParticipant: {
    trackPublications: Map<string, TrackPublication<T>> | Iterable<TrackPublication<T>>;
    unpublishTrack: (track: T, stopOnUnpublish?: boolean) => Promise<unknown>;
  };
  disconnect: (stopTracks?: boolean) => Promise<void>;
};

function publisherOf(room: object) {
  const engine = (room as { engine?: { isClosed?: boolean; pcManager?: { publisher?: object } | null } }).engine;
  return {
    engine,
    publisher: engine?.pcManager?.publisher as OfferPublisher | undefined,
  };
}

/** Skip createOffer once the room is closing or the peer connection is already closed. */
export function silenceClosedOffers(room: object) {
  const { publisher } = publisherOf(room);
  if (!publisher?.createAndSendOffer || publisher.__offerGuarded) return;
  const original = publisher.createAndSendOffer.bind(publisher);
  let closing = false;
  const { engine } = publisherOf(room);
  publisher.createAndSendOffer = (options?: unknown) => {
    const pc = publisher._pc;
    if (closing || engine?.isClosed || !pc || pc.signalingState === "closed") return Promise.resolve();
    return original(options);
  };
  publisher.__offerGuarded = true;
  publisher.__closeOffers = () => {
    closing = true;
  };
}

/** Install the offer guard and reject any negotiation that has not started yet. */
export function abortPracticeNegotiation(room: object) {
  silenceClosedOffers(room);
  publisherOf(room).publisher?.__closeOffers?.();
}

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
  abortPracticeNegotiation(room);
  if (room.state === "disconnected") return;
  for (const pub of publicationsOf(room)) {
    const track = pub?.track;
    if (!track) continue;
    if (!pub.trackSid) {
      try {
        track.stop?.();
      } catch {
        /* already stopped */
      }
      continue;
    }
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
  if (room.state === "disconnected") return;
  try {
    await room.disconnect(true);
  } catch {
    /* already disconnected */
  }
}
