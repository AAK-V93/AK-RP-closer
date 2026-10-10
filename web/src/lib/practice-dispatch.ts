import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";

export function livekitHttpHost(url: string) {
  return url.replace(/^ws/i, "http");
}

/** One warm room per closer per minute. The job metadata tells the worker to exit. */
export function practiceWarmRoomName(userId: string, now = Date.now()) {
  const bucket = Math.floor(now / 60_000);
  const key = userId.replace(/[^a-z0-9]/gi, "").slice(0, 12) || "anon";
  return `warm-${key}-${bucket}`;
}

export function practiceWarmMetadata() {
  return JSON.stringify({ warm: true });
}

export function practiceAgentName(env?: { LIVEKIT_AGENT_NAME?: string | undefined }) {
  const name = (env ?? process.env).LIVEKIT_AGENT_NAME?.trim();
  return name || "closer-trainer";
}

/**
 * Wake the LiveKit worker before the closer taps Entrar.
 * This is not LIVEKIT_PREDISPATCH: the user token still dispatches on join.
 * The worker must leave a warm job immediately. The image deployed before this
 * change waits up to 75s in an empty room and then leaves.
 */
export async function warmPracticeWorker(args: {
  url: string;
  apiKey: string;
  apiSecret: string;
  userId: string;
  now?: number;
}): Promise<boolean> {
  const roomName = practiceWarmRoomName(args.userId, args.now);
  const host = livekitHttpHost(args.url);
  const rooms = new RoomServiceClient(host, args.apiKey, args.apiSecret);
  try {
    await rooms.createRoom({
      name: roomName,
      emptyTimeout: 30,
      departureTimeout: 5,
    });
  } catch {
    /* already created this minute */
  }
  const dispatch = new AgentDispatchClient(host, args.apiKey, args.apiSecret);
  await dispatch.createDispatch(roomName, practiceAgentName(), {
    metadata: practiceWarmMetadata(),
  });
  return true;
}

/**
 * Create the room and dispatch the voice worker before the browser connects.
 * The token route only does so when LIVEKIT_PREDISPATCH=1. Page-load warm
 * uses warmPracticeWorker instead, and that flag stays unset.
 */
export async function dispatchPracticeAgent(args: {
  url: string;
  apiKey: string;
  apiSecret: string;
  roomName: string;
  metadata: string;
}): Promise<boolean> {
  const host = livekitHttpHost(args.url);
  const rooms = new RoomServiceClient(host, args.apiKey, args.apiSecret);
  try {
    await rooms.createRoom({
      name: args.roomName,
      emptyTimeout: 180,
      departureTimeout: 15,
    });
  } catch {
    /* room may already exist */
  }
  const dispatch = new AgentDispatchClient(host, args.apiKey, args.apiSecret);
  await dispatch.createDispatch(args.roomName, practiceAgentName(), {
    metadata: args.metadata,
  });
  return true;
}
