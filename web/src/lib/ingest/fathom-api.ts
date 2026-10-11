// Fathom External API v1, only what ingestion needs (plan 2.6). Public docs:
// https://developers.fathom.ai (GET /meetings, POST/DELETE /webhooks).
//
// Rules: one request per call, never a retry loop. A 429 comes back as
// FathomRateLimited with Retry-After so the caller stops the burst and saves
// when it may continue. `fetch` is injectable: tests use fixtures, never Fathom.

export const FATHOM_API = "https://api.fathom.ai/external/v1";
const TIMEOUT_MS = 20_000;

export type FathomFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Only outside production, for a local smoke test against a fake server. */
export function fathomBase() {
  const override = process.env.FATHOM_API_BASE?.trim();
  return override && process.env.NODE_ENV !== "production" ? override.replace(/\/$/, "") : FATHOM_API;
}

export type FathomSpeaker = { display_name?: string | null; matched_calendar_invitee_email?: string | null };
export type FathomTranscriptRow = { speaker?: FathomSpeaker | null; text?: string | null; timestamp?: string | null };
export type FathomActionItem = {
  description?: string | null;
  user_generated?: boolean | null;
  completed?: boolean | null;
  recording_timestamp?: string | null;
  recording_playback_url?: string | null;
  assignee?: { name?: string | null; email?: string | null; team?: string | null } | null;
};
export type FathomInvitee = {
  name?: string | null;
  email?: string | null;
  email_domain?: string | null;
  is_external?: boolean | null;
  matched_speaker_display_name?: string | null;
};
/** Meeting object (GET /meetings item and webhook payload). Every field may be missing. */
export type FathomMeeting = {
  title?: string | null;
  meeting_title?: string | null;
  recording_id?: number | string | null;
  url?: string | null;
  share_url?: string | null;
  created_at?: string | null;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  recording_start_time?: string | null;
  recording_end_time?: string | null;
  transcript_language?: string | null;
  transcript?: FathomTranscriptRow[] | null;
  default_summary?: { template_name?: string | null; markdown_formatted?: string | null } | null;
  action_items?: FathomActionItem[] | null;
  calendar_invitees?: FathomInvitee[] | null;
  recorded_by?: { name?: string | null; email?: string | null } | null;
};
export type FathomMeetingsPage = { items: FathomMeeting[]; nextCursor: string | null };

export class FathomError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FathomError";
  }
}

/** 429: stop here and continue after `retryAfterSec`. Never retried in a loop. */
export class FathomRateLimited extends FathomError {
  constructor(readonly retryAfterSec: number) {
    super(`Fathom rate limit, retry after ${retryAfterSec}s`, 429);
    this.name = "FathomRateLimited";
  }
}

export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  if (!header) return 60;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return Math.min(Math.max(Math.ceil(n), 1), 3600);
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.min(Math.max(Math.ceil((at - now) / 1000), 1), 3600);
  return 60;
}

async function request<T>(fetchFn: FathomFetch, apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(`${fathomBase()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "X-Api-Key": apiKey, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (res.status === 429) throw new FathomRateLimited(retryAfterSeconds(res.headers.get("retry-after")));
    const text = await res.text();
    if (!res.ok) throw new FathomError(`Fathom ${res.status}`, res.status);
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    if (error instanceof FathomError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new FathomError("Fathom timeout", 504);
    throw new FathomError(error instanceof Error ? error.message : String(error), 502);
  } finally {
    clearTimeout(timer);
  }
}

export type FathomClient = {
  /** one page (Fathom returns up to 10). Includes summary, action items and transcript. */
  listMeetings(opts: { createdAfter: string; cursor?: string | null }): Promise<FathomMeetingsPage>;
  /** cheapest call that proves the key works (no summary, no transcript) */
  checkKey(): Promise<void>;
  createWebhook(destinationUrl: string): Promise<{ id: string; secret: string }>;
  deleteWebhook(id: string): Promise<void>;
};

export function fathomClient(apiKey: string, fetchFn: FathomFetch = fetch): FathomClient {
  return {
    async listMeetings({ createdAfter, cursor }) {
      const q = new URLSearchParams({
        created_after: createdAfter,
        include_summary: "true",
        include_action_items: "true",
        include_transcript: "true",
      });
      if (cursor) q.set("cursor", cursor);
      const data = await request<{ items?: FathomMeeting[] | null; next_cursor?: string | null }>(
        fetchFn, apiKey, `/meetings?${q.toString()}`,
      );
      return { items: Array.isArray(data.items) ? data.items : [], nextCursor: data.next_cursor || null };
    },
    async checkKey() {
      await request(fetchFn, apiKey, `/meetings?${new URLSearchParams({ created_after: new Date().toISOString() })}`);
    },
    async createWebhook(destinationUrl) {
      const data = await request<{ id?: string | number; secret?: string }>(fetchFn, apiKey, "/webhooks", {
        method: "POST",
        body: JSON.stringify({
          destination_url: destinationUrl,
          triggered_for: ["my_recordings", "shared_external_recordings"],
          include_transcript: true,
          include_summary: true,
          include_action_items: true,
          include_crm_matches: false,
        }),
      });
      if (!data.id || !data.secret) throw new FathomError("Fathom webhook without id/secret", 502);
      return { id: String(data.id), secret: data.secret };
    },
    async deleteWebhook(id) {
      try {
        await request(fetchFn, apiKey, `/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch (error) {
        // already gone is fine
        if (!(error instanceof FathomError && error.status === 404)) throw error;
      }
    },
  };
}
