import { createHmac, timingSafeEqual } from "crypto";
import type { PrismaClient } from "@prisma/client";
import webpush from "web-push";
import { appUrl } from "@/lib/app-url";
import { moneyLabel } from "@/lib/crm-operacion";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  alertId?: string;
  token?: string;
  tag?: string;
};

const TYPE_LEAD: Record<string, string> = {
  "PAGO PENDIENTE": "Cobrar a",
  COBRO_VENCIDO: "Cobrar a",
  PRE_COBRANZA: "Cobrar a",
  DECISION: "Decidir con",
  RETOMAR: "Retomar a",
  REAGENDAR: "Reagendar a",
  "SEGUNDA REUNION": "Segunda reunión con",
  COMISION: "Comisión de",
  AGENDA_CHECK: "¿Se hizo la llamada con",
  ONBOARDING: "Onboarding de",
  VALIDACION: "Validar a",
  EXPERIENCIA: "Seguimiento de",
  POST_COBRANZA: "Post-cobranza de",
};

function vapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const email = process.env.VAPID_CONTACT?.trim() || "mailto:closer@localhost";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, email };
}

export function vapidPublicKey() {
  return vapid()?.publicKey || "";
}

function configureWebPush() {
  const keys = vapid();
  if (!keys) return false;
  webpush.setVapidDetails(keys.email, keys.publicKey, keys.privateKey);
  return true;
}

function actionSecret() {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    ""
  );
}

export function signPushAction(args: { userId: string; alertId: string }) {
  const secret = actionSecret();
  if (!secret) return "";
  const exp = Date.now() + 7 * 24 * 3600 * 1000;
  const payload = Buffer.from(
    JSON.stringify({ userId: args.userId, alertId: args.alertId, exp }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPushAction(token: string): { userId: string; alertId: string } | null {
  const secret = actionSecret();
  if (!secret || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      userId?: string;
      alertId?: string;
      exp?: number;
    };
    if (!data.userId || !data.alertId) return null;
    if (data.exp && data.exp < Date.now()) return null;
    return { userId: data.userId, alertId: data.alertId };
  } catch {
    return null;
  }
}

export function formatDueLabel(dueAt: Date, timezone = "America/Lima", now = new Date()) {
  const fmt = new Intl.DateTimeFormat("es", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dueDay = dayFmt.format(dueAt);
  const today = dayFmt.format(now);
  const tomorrowDate = new Date(now.getTime() + 86400000);
  const tomorrow = dayFmt.format(tomorrowDate);
  const clock = fmt.format(dueAt).replace(/^.*,\s*/, "").replace(/\s/g, " ").trim();
  if (dueDay === today) return `hoy ${clock}`;
  if (dueDay === tomorrow) return `mañana ${clock}`;
  return fmt.format(dueAt);
}

export function alertPushBody(args: {
  type: string;
  leadName: string;
  enJuego?: number;
  dueAt?: Date | null;
  timezone?: string;
  currency?: string;
}) {
  const verb = TYPE_LEAD[args.type] || `${args.type} ·`;
  const name = args.leadName || "lead";
  const head = verb.endsWith("con") || verb.endsWith("de") || verb.endsWith("a")
    ? `${verb} ${name}`
    : `${verb} ${name}`;
  const bits = [head.replace(/\s+/g, " ").trim()];
  if (args.enJuego && args.enJuego > 0) {
    bits.push(moneyLabel(args.enJuego, args.currency || "USD"));
  }
  if (args.dueAt) {
    bits.push(formatDueLabel(args.dueAt, args.timezone));
  }
  return bits.join(" · ");
}

export function filingPushBody(args: {
  leadName?: string | null;
  offerName?: string | null;
  estado?: string | null;
  followup?: string | null;
  gap?: string | null;
}) {
  if (args.gap) return args.gap;
  const bits = [args.leadName, args.offerName, args.estado, args.followup]
    .map((row) => String(row || "").trim())
    .filter(Boolean);
  return bits.join(" · ") || "Llamada lista";
}

export async function sendPushToUser(
  prisma: PrismaClient,
  userId: string,
  payload: PushPayload,
) {
  if (!configureWebPush()) return { sent: 0, gone: 0 };
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subs.length) return { sent: 0, gone: 0 };
  const body = JSON.stringify({
    title: payload.title || "Closer Trainer",
    body: payload.body,
    url: payload.url,
    alertId: payload.alertId || "",
    token: payload.token || "",
    tag: payload.tag || payload.alertId || "hub",
  });
  let sent = 0;
  let gone = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 * 12, urgency: "high" },
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          gone += 1;
        } else {
          console.error("web-push", error);
        }
      }
    }),
  );
  return { sent, gone };
}

export async function notifyDueAlerts(prisma: PrismaClient) {
  const due = await prisma.leadAlert.findMany({
    where: {
      resolvedAt: null,
      notifiedAt: null,
      dueAt: { lte: new Date() },
    },
    include: {
      lead: { select: { name: true } },
      user: { select: { crmPrefs: true } },
    },
    take: 200,
  });
  const origin = appUrl();
  let pushed = 0;
  for (const alert of due) {
    const timezone =
      alert.user.crmPrefs && typeof alert.user.crmPrefs === "object"
        ? String((alert.user.crmPrefs as Record<string, unknown>).timezone || "America/Lima")
        : "America/Lima";
    const token = signPushAction({ userId: alert.userId, alertId: alert.id });
    const body = alertPushBody({
      type: alert.type,
      leadName: alert.lead.name,
      enJuego: alert.enJuego,
      dueAt: alert.dueAt,
      timezone,
    });
    const out = await sendPushToUser(prisma, alert.userId, {
      title: "Closer Trainer",
      body,
      url: `${origin}/?alert=${encodeURIComponent(alert.id)}`,
      alertId: alert.id,
      token,
      tag: `alert-${alert.id}`,
    });
    if (out.sent > 0) {
      await prisma.leadAlert.update({
        where: { id: alert.id },
        data: { notifiedAt: new Date() },
      });
      pushed += 1;
    }
  }
  return { due: due.length, pushed };
}

export async function notifyFiling(
  prisma: PrismaClient,
  userId: string,
  args: {
    leadName?: string | null;
    offerName?: string | null;
    estado?: string | null;
    followup?: string | null;
    gap?: string | null;
    alertId?: string;
  },
) {
  const origin = appUrl();
  const body = filingPushBody(args);
  const token = args.alertId
    ? signPushAction({ userId, alertId: args.alertId })
    : "";
  return sendPushToUser(prisma, userId, {
    title: args.gap ? "Falta un dato" : "Llamada lista",
    body,
    url: args.alertId
      ? `${origin}/?alert=${encodeURIComponent(args.alertId)}`
      : `${origin}/`,
    alertId: args.alertId,
    token,
    tag: args.alertId ? `alert-${args.alertId}` : "filing",
  });
}
