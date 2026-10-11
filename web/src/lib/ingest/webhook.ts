// POST /api/fathom/webhook/[token] (plan 2.6). The token in the URL says whose
// webhook it is (Fathom's payload has no user). Signature first; then the call
// is stored once (a resend with the same webhook-id, or the same recording,
// hits the unique and changes nothing); the brief runs after the response.
import type { PrismaClient } from "@prisma/client";
import { verifyFathomWebhookSignature } from "@/lib/fathom";
import { readWebhookTarget } from "@/lib/read/fathom";
import { decryptSecret } from "@/lib/secret-crypto";
import { briefIngestedCall, ingestCall } from "@/lib/write/ingest";
import type { WriteOpts } from "@/lib/write/offers";
import { type ModelCall, briefModelAvailable, defaultBriefModel } from "./brief";
import type { FathomMeeting } from "./fathom-api";
import { fromFathomMeeting } from "./meeting";

export const WEBHOOK_MAX_BYTES = 5_000_000;

export type WebhookReply = { status: number; body: Record<string, unknown>; later?: () => Promise<unknown> };

export async function handleFathomWebhook(
  db: PrismaClient,
  token: string,
  headers: Headers,
  rawBody: string,
  deps: { model?: ModelCall | null; revalidate?: WriteOpts["revalidate"]; now?: Date } = {},
): Promise<WebhookReply> {
  const target = await readWebhookTarget(db, token);
  if (!target?.webhookSecretEnc) return { status: 404, body: { ok: false } };
  let secret: string;
  try {
    secret = decryptSecret(target.webhookSecretEnc);
  } catch {
    return { status: 401, body: { ok: false } };
  }
  if (!verifyFathomWebhookSignature(secret, headers, rawBody)) return { status: 401, body: { ok: false } };
  let meeting: FathomMeeting;
  try {
    const parsed = JSON.parse(rawBody) as FathomMeeting & { meeting?: FathomMeeting };
    meeting = parsed.meeting && typeof parsed.meeting === "object" ? parsed.meeting : parsed;
  } catch {
    return { status: 400, body: { ok: false } };
  }
  const input = fromFathomMeeting(meeting, deps.now);
  // nothing to identify the recording: acknowledge so Fathom does not resend forever
  if (!input) return { status: 200, body: { ok: true, ignored: true } };
  const opts = { revalidate: deps.revalidate, now: deps.now };
  // no revalidation here: the brief after the response invalidates the same tags (and more), and
  // Next drops an after() revalidation of a tag this request already revalidated
  const saved = await ingestCall(db, target.userId, input, { ...opts, revalidate: () => {} });
  if (!saved.ok) return { status: 500, body: { ok: false } };
  if (!saved.created) return { status: 200, body: { ok: true, duplicate: true } };
  const model = deps.model !== undefined ? deps.model : briefModelAvailable() ? defaultBriefModel : null;
  return {
    status: 200,
    body: { ok: true },
    later: () => briefIngestedCall(db, target.userId, saved.callId, input, { model }, opts),
  };
}
