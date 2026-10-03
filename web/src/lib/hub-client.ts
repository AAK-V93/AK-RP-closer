export type HubGet = {
  messages?: { id: string; role: "user" | "coach"; content: string }[];
  snapshot?: unknown;
  error?: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  json: () => Promise<HubGet>;
}>;

const FRESH_MS = 20_000;

/** One in-flight GET /api/hub, reused by Inicio and the dock chat. */
export function createHubCache(now: () => number = () => Date.now()) {
  let cached: { at: number; data: HubGet } | null = null;
  let inflight: Promise<HubGet> | null = null;
  let inflightForce = false;

  function remember(data: HubGet) {
    cached = {
      at: now(),
      data: {
        messages: data.messages ?? cached?.data.messages,
        snapshot: data.snapshot ?? cached?.data.snapshot,
        error: data.error,
      },
    };
  }

  function invalidate() {
    cached = null;
  }

  function rememberLines(lines: NonNullable<HubGet["messages"]>) {
    if (!lines.length) return;
    const prev = cached?.data.messages || [];
    cached = {
      at: cached?.at ?? now(),
      data: {
        messages: [...prev, ...lines],
        snapshot: cached?.data.snapshot,
        error: cached?.data.error,
      },
    };
  }

  function load(fetchImpl: FetchLike, opts?: { force?: boolean }) {
    const force = Boolean(opts?.force);
    if (!force && cached && now() - cached.at < FRESH_MS) {
      return Promise.resolve(cached.data);
    }
    if (inflight && (!force || inflightForce)) return inflight;
    inflightForce = force;
    const run = fetchImpl("/api/hub", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.snapshot == null) {
          throw new Error(data.error || "No se pudo cargar el inicio");
        }
        remember(data);
        return data;
      })
      .finally(() => {
        if (inflight === run) {
          inflight = null;
          inflightForce = false;
        }
      });
    inflight = run;
    return run;
  }

  return { load, remember, rememberLines, invalidate };
}

const shared = createHubCache();

export function loadHub(opts?: { force?: boolean }) {
  return shared.load(fetch, opts);
}

export function rememberHub(data: HubGet) {
  shared.remember(data);
}

export function invalidateHub() {
  shared.invalidate();
}

export function rememberHubLines(lines: NonNullable<HubGet["messages"]>) {
  shared.rememberLines(lines);
}

export const HUB_RETRY_MS = 1500;

/** One automatic retry, then a manual button. A snapshot already on screen can stay usable. */
export function hubLoadRetry(args: { attempt: number; hasSnapshot: boolean }) {
  if (args.hasSnapshot) return "ready" as const;
  if (args.attempt < 1) return "auto" as const;
  return "manual" as const;
}

/** The first chat send waits until a real hub snapshot has loaded. */
export function chatSendReady(args: { loading: boolean; hubResolved: boolean }) {
  return !args.loading && args.hubResolved;
}

/** No POST while the hub is still loading or the last read failed. */
export function hubChatPostBody(args: { loading: boolean; hubResolved: boolean; text: string }) {
  if (!chatSendReady(args)) return null;
  const text = args.text.trim();
  if (!text) return null;
  return { message: text };
}
