import { createHmac } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";
import { upsertLeadForAgenda } from "@/lib/agenda";

const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

export function googleCalendarConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
}

function appUrl() {
  return (
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

function secret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "calendar";
}

export function calendarOAuthUrl(userId: string) {
  const state = Buffer.from(
    JSON.stringify({
      userId,
      h: createHmac("sha256", secret()).update(userId).digest("hex").slice(0, 24),
    }),
  ).toString("base64url");
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: `${appUrl()}/api/calendar/callback`,
    response_type: "code",
    scope: CAL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function parseCalendarState(state: string) {
  try {
    const raw = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      userId?: string;
      h?: string;
    };
    if (!raw.userId || !raw.h) return null;
    const expect = createHmac("sha256", secret()).update(raw.userId).digest("hex").slice(0, 24);
    if (expect !== raw.h) return null;
    return raw.userId;
  } catch {
    return null;
  }
}

async function exchangeCode(code: string) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: `${appUrl()}/api/calendar/callback`,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { refresh_token?: string; error?: string };
  if (!res.ok || !json.refresh_token) {
    throw new Error(json.error || "Google no devolvió refresh_token");
  }
  return json.refresh_token;
}

async function accessToken(refreshEnc: string) {
  const refresh = decryptSecret(refreshEnc);
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("No se pudo renovar Calendar");
  return json.access_token;
}

function isMeetOrZoom(event: {
  hangoutLink?: string;
  location?: string;
  description?: string;
  conferenceData?: { entryPoints?: { uri?: string }[] };
}) {
  const blob = [
    event.hangoutLink,
    event.location,
    event.description,
    ...(event.conferenceData?.entryPoints || []).map((row) => row.uri),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /zoom\.us|meet\.google|meet\.google\.com|hangouts|teams\.microsoft/.test(blob);
}

function leadNameFromEvent(summary: string) {
  const cleaned = summary
    .replace(/zoom|meet|google|llamada|call|reunion|reunión|with|con/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 80) || summary.slice(0, 80);
}

export async function saveCalendarRefresh(prisma: PrismaClient, userId: string, code: string) {
  const token = await exchangeCode(code);
  await prisma.user.update({
    where: { id: userId },
    data: {
      calendarRefreshEnc: encryptSecret(token),
      calendarSyncedAt: new Date(),
    },
  });
}

export async function disconnectCalendar(prisma: PrismaClient, userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { calendarRefreshEnc: "", calendarSyncedAt: null },
  });
}

export async function syncUserCalendar(prisma: PrismaClient, userId: string, refreshEnc: string) {
  const token = await accessToken(refreshEnc);
  const timeMin = new Date(Date.now() - 2 * 86400000).toISOString();
  const timeMax = new Date(Date.now() + 21 * 86400000).toISOString();
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "80");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json()) as {
    items?: {
      id?: string;
      summary?: string;
      hangoutLink?: string;
      location?: string;
      description?: string;
      start?: { dateTime?: string; date?: string };
      conferenceData?: { entryPoints?: { uri?: string }[] };
    }[];
  };
  if (!res.ok) throw new Error("Calendar API");
  let upserted = 0;
  for (const event of json.items || []) {
    if (!event.id || !isMeetOrZoom(event)) continue;
    const startRaw = event.start?.dateTime || event.start?.date;
    if (!startRaw) continue;
    const when = new Date(startRaw);
    if (Number.isNaN(when.getTime())) continue;
    const title = event.summary?.trim() || "Llamada";
    const leadName = leadNameFromEvent(title);
    const existing = await prisma.callRecord.findUnique({
      where: {
        userId_source_sourceId: {
          userId,
          source: "calendar",
          sourceId: event.id,
        },
      },
    });
    if (existing && existing.estadoAgenda && existing.estadoAgenda !== "AGENDADO") {
      continue;
    }
    await prisma.callRecord.upsert({
      where: {
        userId_source_sourceId: {
          userId,
          source: "calendar",
          sourceId: event.id,
        },
      },
      create: {
        userId,
        source: "calendar",
        sourceId: event.id,
        title,
        leadName,
        estadoAgenda: "AGENDADO",
        callType: "AGENDADO",
        recordedAt: when,
        filingStatus: "confirmed",
        confirmedAt: new Date(),
        summary: `AGENDADO · ${leadName}`,
      },
      update: {
        title,
        leadName,
        recordedAt: when,
      },
    });
    await upsertLeadForAgenda(prisma, userId, leadName);
    upserted += 1;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { calendarSyncedAt: new Date() },
  });
  return upserted;
}

export async function syncAllCalendars(prisma: PrismaClient) {
  const users = await prisma.user.findMany({
    where: { calendarRefreshEnc: { not: "" } },
    select: { id: true, calendarRefreshEnc: true },
    take: 80,
  });
  let events = 0;
  for (const user of users) {
    try {
      events += await syncUserCalendar(prisma, user.id, user.calendarRefreshEnc);
    } catch (error) {
      console.error("calendar sync", user.id, error);
    }
  }
  return { users: users.length, events };
}
