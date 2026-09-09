const FATHOM_BASE = "https://api.fathom.ai/external/v1";

export type FathomMeeting = {
  title: string;
  meeting_title?: string | null;
  recording_id: number;
  share_url?: string;
  url?: string;
  created_at?: string;
  recording_start_time?: string;
  recording_end_time?: string;
  recorded_by?: { name?: string; email?: string };
  transcript?: FathomTranscriptPayload[] | null;
};

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

async function fathomFetch<T>(
  apiKey: string,
  path: string,
  query?: Record<string, string | boolean | undefined>,
) {
  const url = new URL(`${FATHOM_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "X-Api-Key": apiKey,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new FathomApiError(
          raw.slice(0, 280) || `Fathom API error (${response.status})`,
          response.status,
        );
      }

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

export async function getFathomTranscript(apiKey: string, recordingId: number) {
  const data = await fathomFetch<TranscriptResponse>(
    apiKey,
    `/recordings/${recordingId}/transcript`,
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
