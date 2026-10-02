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

type LeavingRoom = {
  __practiceLeaving?: boolean;
  clearConnectionReconcile?: () => void;
};

const PRACTICE_LEAVE_NOISE =
  /detected connection state mismatch|websocket closed|closed before the connection is established/i;

/** LiveKit logs these when we close a socket that is still connecting. */
export function isPracticeLeaveNoise(message: string) {
  return PRACTICE_LEAVE_NOISE.test(message);
}

/**
 * Stop the 4s reconcile loop before the engine closes.
 * Otherwise it warns "detected connection state mismatch" on cancel.
 */
export function markPracticeLeaving(room: object) {
  const target = room as LeavingRoom;
  target.__practiceLeaving = true;
  try {
    target.clearConnectionReconcile?.();
  } catch {
    /* not connected yet */
  }
}

/** A new connection cancels a disconnect that is still in flight. */
export function resetPracticeRoom(room: object) {
  leaveTokens.set(room, (leaveTokens.get(room) || 0) + 1);
  leavingRooms.delete(room);
  (room as LeavingRoom).__practiceLeaving = false;
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

export function isUserPracticeDisconnect(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /client initiated disconnect|abort connection attempt due to user initiated disconnect/i.test(
    message,
  );
}

type LocalTrack = { stop?: () => void };

type GuardedParticipant = {
  unpublishTrack: (track: LocalTrack, stopOnUnpublish?: boolean) => Promise<unknown>;
  getPublicationForTrack?: (track: unknown) => { track?: unknown; trackSid?: string } | undefined;
  trackPublications: Map<string, { track?: LocalTrack | null; trackSid?: string }>;
  audioTrackPublications?: Map<string, unknown>;
  videoTrackPublications?: Map<string, unknown>;
  pendingPublishPromises?: Map<unknown, Promise<unknown>>;
};

type GuardedRoom = PracticeRoom<LocalTrack> & LeavingRoom & {
  connect?: (...args: unknown[]) => Promise<unknown>;
  log?: { warn?: (...args: unknown[]) => void };
  __practiceGuarded?: boolean;
  localParticipant: GuardedParticipant;
};

function publicationFor(participant: GuardedParticipant, track: unknown) {
  if (typeof participant.getPublicationForTrack === "function") {
    const found = participant.getPublicationForTrack(track);
    if (found) return found;
  }
  for (const pub of participant.trackPublications.values()) {
    if (pub.track === track) return pub;
  }
  return undefined;
}

/** Drop local tracks that were created but never published, so disconnect does not unpublish them. */
export function scrubUnpublishedLocalTracks(room: { localParticipant: GuardedParticipant }) {
  const participant = room.localParticipant;
  const pending = participant.pendingPublishPromises;
  if (pending) {
    for (const [track] of pending) {
      try {
        (track as LocalTrack | undefined)?.stop?.();
      } catch {
        /* already stopped */
      }
    }
    pending.clear();
  }
  for (const [sid, pub] of [...participant.trackPublications.entries()]) {
    if (pub.trackSid && pub.track) continue;
    try {
      pub.track?.stop?.();
    } catch {
      /* already stopped */
    }
    participant.trackPublications.delete(sid);
    participant.audioTrackPublications?.delete(sid);
    participant.videoTrackPublications?.delete(sid);
  }
}

/**
 * LiveKit's disconnect(stopTracks) calls unpublishTrack on every local track,
 * including ones still in pendingPublishPromises. That awaits the publish and
 * then warns "track was not unpublished because no publication was found".
 * The room's connect() rejection ("Client initiated disconnect") is the same cancel.
 */
export function guardPracticeRoom(room: GuardedRoom) {
  if (room.__practiceGuarded) return;
  room.__practiceGuarded = true;
  const participant = room.localParticipant;
  const originalUnpublish = participant.unpublishTrack.bind(participant);
  participant.unpublishTrack = async (track, stopOnUnpublish) => {
    participant.pendingPublishPromises?.delete(track);
    const publication = publicationFor(participant, track);
    if (!publication?.track || !publication.trackSid) {
      try {
        track?.stop?.();
      } catch {
        /* already stopped */
      }
      return undefined;
    }
    return originalUnpublish(track, stopOnUnpublish);
  };
  if (room.disconnect) {
    const originalDisconnect = room.disconnect.bind(room);
    room.disconnect = async (stopTracks?: boolean) => {
      markPracticeLeaving(room);
      scrubUnpublishedLocalTracks(room);
      return originalDisconnect(stopTracks);
    };
  }
  if (room.connect) {
    const originalConnect = room.connect.bind(room);
    room.connect = async (...args: unknown[]) => {
      try {
        return await originalConnect(...args);
      } catch (error) {
        if (isUserPracticeDisconnect(error)) return undefined;
        throw error;
      }
    };
  }
  const log = room.log;
  if (log?.warn) {
    const originalWarn = log.warn.bind(log);
    log.warn = (...args: unknown[]) => {
      const blob = args
        .map((item) => (item instanceof Error ? `${item.name} ${item.message}` : String(item ?? "")))
        .join(" ");
      if (isUserPracticeDisconnect(blob)) return;
      if (room.__practiceLeaving && isPracticeLeaveNoise(blob)) return;
      originalWarn(...args);
    };
  }
}

async function leaveOnce<T extends { stop?: () => void }>(room: PracticeRoom<T>, token: number) {
  if ((leaveTokens.get(room) || 0) !== token) return;
  markPracticeLeaving(room);
  guardPracticeRoom(room as GuardedRoom);
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
