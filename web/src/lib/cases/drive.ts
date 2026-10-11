// Google Drive with scope drive.file: its own consent and refresh token,
// separate from Calendar. Same GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
import { createHmac, timingSafeEqual } from "node:crypto";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export function driveConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

/** The Picker also needs a browser key and the Cloud project number (setAppId). */
export function pickerConfig() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY?.trim() || "";
  const appId = process.env.NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER?.trim() || "";
  return driveConfigured() && apiKey && appId ? { apiKey, appId } : null;
}

function stateKey() {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET is required");
  return secret;
}

/** state = base64url(json).signature, valid 10 minutes, bound to the user. */
export function signDriveState(payload: { userId: string; offerId: string }, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + 10 * 60_000 })).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(`drive:${body}`).digest("base64url");
  return `${body}.${sig}`;
}

export function readDriveState(state: string, userId: string, now = Date.now()) {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateKey()).update(`drive:${body}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { userId: string; offerId: string; exp: number };
  if (data.userId !== userId || data.exp < now) return null;
  return data;
}

export function driveAuthUrl(redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>, f: typeof fetch = fetch) {
  const res = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      ...body,
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number };
}

export function exchangeDriveCode(code: string, redirectUri: string, f?: typeof fetch) {
  return tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" }, f);
}

export async function driveAccessToken(refreshToken: string, f?: typeof fetch) {
  const data = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" }, f);
  return data?.access_token ?? null;
}
