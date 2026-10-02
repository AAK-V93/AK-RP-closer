import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";

export function livekitHttpHost(url: string) {
  return url.replace(/^ws/i, "http");
}

/**
 * Create the room and dispatch the voice worker before the browser connects,
 * so a cold worker can boot while the token response and the mic prompt run.
 * Returns false when dispatch is unavailable; the caller falls back to
 * dispatch-on-join via the access token.
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
  await dispatch.createDispatch(args.roomName, "closer-trainer", {
    metadata: args.metadata,
  });
  return true;
}
