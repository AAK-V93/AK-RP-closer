import { createHmac, timingSafeEqual } from "crypto";

const FATHOM_BASE = "https://api.fathom.ai/external/v1";
const WEBHOOK_MAX_SKEW_SEC = 300;

export type FathomMeeting = {
  title: string;
  meeting_title?: string | null;
  recording_id: number | string;
  share_url?: string;
  url?: string;
  created_at?: string;
  recording_start_time?: string;
  recording_end_time?: string;
  recorded_by?: { name?: string; email?: string };
  transcript?: FathomTranscriptPayload[] | null;
};

export function normalizeFathomRecordingId(raw: unknown): string {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return "";
    return String(Math.trunc(raw));
  }
  const text = String(raw ?? "").trim();
  if (!text || text === "undefined" || text === "null" || text === "0") return "";
  return text.slice(0, 64);
}

export type FathomTranscriptPayload = {
  speaker?: { display_name?: string };
  text?: string;
  timestamp?: string;
};

type MeetingListResponse = {
  limit?: number | null;
  next_cursor?: string | null;
  items?: FathomMeeting[];
};

type TranscriptResponse = {
  transcript?: FathomTranscriptPayload[];
};

export class FathomApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function fathomRequest<T>(
  apiKey: string,
  path: string,
  args?: {
    query?: Record<string, string | boolean | undefined>;
    method?: string;
    body?: unknown;
  },
) {
  const url = new URL(`${FATHOM_BASE}${path}`);
  if (args?.query) {
    for (const [key, value] of Object.entries(args.query)) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: args?.method || "GET",
        headers: {
          "X-Api-Key": apiKey,
          Accept: "application/json",
          ...(args?.body ? { "Content-Type": "application/json" } : {}),
        },
        body: args?.body ? JSON.stringify(args.body) : undefined,
        cache: "no-store",
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new FathomApiError(
          raw.slice(0, 280) || `Fathom API error (${response.status})`,
          response.status,
        );
      }

      if (!raw.trim()) return {} as T;
      return JSON.parse(raw) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (error instanceof FathomApiError && error.status < 500 && error.status !== 429) {
        throw error;
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  throw lastError || new Error("Fathom API request failed");
}

async function fathomFetch<T>(
  apiKey: string,
  path: string,
  query?: Record<string, string | boolean | undefined>,
) {
  return fathomRequest<T>(apiKey, path, { query });
}

export async function verifyFathomApiKey(apiKey: string) {
  const data = await fathomFetch<MeetingListResponse>(apiKey, "/meetings", {
    calendar_invitees_domains_type: "all",
  });
  return Array.isArray(data.items);
}

export async function listFathomMeetings(
  apiKey: string,
  args: {
    cursor?: string | null;
    includeTranscript?: boolean;
    createdAfter?: string | null;
  } = {},
) {
  return fathomFetch<MeetingListResponse>(apiKey, "/meetings", {
    cursor: args.cursor || undefined,
    include_transcript: args.includeTranscript ? "true" : undefined,
    calendar_invitees_domains_type: "all",
    created_after: args.createdAfter || undefined,
  });
}

export async function getFathomTranscript(apiKey: string, recordingId: string | number) {
  const id = normalizeFathomRecordingId(recordingId);
  if (!id) throw new FathomApiError("recording id inválido", 400);
  const data = await fathomFetch<TranscriptResponse>(
    apiKey,
    `/recordings/${id}/transcript`,
  );
  return data.transcript || [];
}

export function meetingTitle(meeting: FathomMeeting) {
  return (
    meeting.meeting_title?.trim() ||
    meeting.title?.trim() ||
    `Llamada ${meeting.recording_id}`
  );
}

export function meetingRecordedAt(meeting: FathomMeeting) {
  const raw =
    meeting.recording_start_time ||
    meeting.created_at ||
    meeting.recording_end_time;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type FathomWebhook = {
  id: string;
  url: string;
  secret: string;
  created_at?: string;
  include_transcript?: boolean;
  triggered_for?: string[];
};

export async function createFathomWebhook(
  apiKey: string,
  args: { destinationUrl: string },
) {
  return fathomRequest<FathomWebhook>(apiKey, "/webhooks", {
    method: "POST",
    body: {
      destination_url: args.destinationUrl,
      include_transcript: true,
      triggered_for: ["my_recordings", "shared_external_recordings"],
    },
  });
}

export async function deleteFathomWebhook(apiKey: string, webhookId: string) {
  if (!webhookId) return;
  await fathomRequest<Record<string, never>>(apiKey, `/webhooks/${webhookId}`, {
    method: "DELETE",
  });
}

export function verifyFathomWebhookSignature(
  secret: string,
  headers: Headers,
  rawBody: string,
) {
  const webhookId = headers.get("webhook-id");
  const webhookTimestamp = headers.get("webhook-timestamp");
  const webhookSignature = headers.get("webhook-signature");
  if (!secret || !webhookId || !webhookTimestamp || !webhookSignature) {
    return false;
  }

  const timestamp = Number.parseInt(webhookTimestamp, 10);
  if (!Number.isFinite(timestamp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > WEBHOOK_MAX_SKEW_SEC) return false;

  const encoded = secret.includes("_") ? secret.split("_").slice(1).join("_") : secret;
  const secretBytes = Buffer.from(encoded, "base64");
  const expected = createHmac("sha256", secretBytes)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`)
    .digest("base64");

  return webhookSignature.split(" ").some((part) => {
    const value = part.includes(",") ? part.split(",").slice(1).join(",") : part;
    return safeEqual(expected, value);
  });
}

export function recordingIdFromWebhookPayload(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const nested =
    root.meeting && typeof root.meeting === "object"
      ? (root.meeting as Record<string, unknown>)
      : root.data && typeof root.data === "object"
        ? (root.data as Record<string, unknown>)
        : null;
  const raw = root.recording_id ?? root.recordingId ?? nested?.recording_id ?? nested?.recordingId;
  const value = normalizeFathomRecordingId(raw);
  return value || null;
}

export function meetingFromWebhookPayload(body: unknown): FathomMeeting | null {
  const recordingId = recordingIdFromWebhookPayload(body);
  if (!recordingId) return null;
  const root = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const nested =
    root.meeting && typeof root.meeting === "object"
      ? (root.meeting as Record<string, unknown>)
      : root;
  const transcript = Array.isArray(nested.transcript)
    ? (nested.transcript as FathomTranscriptPayload[])
    : Array.isArray(root.transcript)
      ? (root.transcript as FathomTranscriptPayload[])
      : null;
  return {
    recording_id: recordingId,
    title: String(nested.title || root.title || ""),
    meeting_title: String(nested.meeting_title || root.meeting_title || "") || null,
    share_url: String(nested.share_url || root.share_url || ""),
    url: String(nested.url || root.url || ""),
    created_at: String(nested.created_at || root.created_at || "") || undefined,
    recording_start_time:
      String(nested.recording_start_time || root.recording_start_time || "") || undefined,
    recording_end_time:
      String(nested.recording_end_time || root.recording_end_time || "") || undefined,
    transcript,
  };
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
