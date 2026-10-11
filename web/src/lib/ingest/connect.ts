// «Conectar Fathom» / «Desconectar» (plan 2.6).
//
// Fathom webhooks belong to the API KEY, not to a deployment: production and a
// preview connected with the same key see the same webhooks. So this file only
// ever deletes the ONE webhook whose id is stored in THIS database AND whose
// URL points to THIS deployment's host. It never lists the account's webhooks
// and never deletes one it did not create. In a Vercel preview no webhook is
// created unless FATHOM_WEBHOOK_IN_PREVIEW=1 (the rebuild and upload still work).
import { randomBytes } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { isPublicHttpsUrl } from "@/lib/app-url";
import { readFathomConnection } from "@/lib/read/fathom";
import { decryptSecret } from "@/lib/secret-crypto";
import { type WebhookFields, disconnectFathom, saveFathomConnection } from "@/lib/write/ingest";
import type { WriteOpts } from "@/lib/write/offers";
import { type FathomClient, FathomError, FathomRateLimited, fathomClient } from "./fathom-api";

export type ConnectDeps = {
  clientFor?: (apiKey: string) => FathomClient;
  /** public base URL of THIS deployment (appUrl()) */
  baseUrl: string;
  production?: boolean;
  /** create a webhook here? default: not in a Vercel preview unless FATHOM_WEBHOOK_IN_PREVIEW=1 */
  webhooks?: boolean;
  revalidate?: WriteOpts["revalidate"];
  now?: Date;
};

export function webhooksEnabled(env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV !== "preview" || env.FATHOM_WEBHOOK_IN_PREVIEW?.trim() === "1";
}

export function webhookUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/fathom/webhook/${token}`;
}

const hostOf = (u: string | null | undefined) => {
  try {
    return u ? new URL(u).host.toLowerCase() : null;
  } catch {
    return null;
  }
};

/** The stored webhook was created by this deployment (its URL is on our host). */
export function isOurWebhook(stored: { webhookId: string | null; webhookUrl: string | null } | null, baseUrl: string) {
  const own = hostOf(baseUrl);
  return Boolean(stored?.webhookId && own && hostOf(stored.webhookUrl) === own);
}

function fathomMessage(error: unknown) {
  if (error instanceof FathomRateLimited) return "Fathom está ocupado. Prueba de nuevo en un minuto.";
  if (error instanceof FathomError && (error.status === 401 || error.status === 403)) {
    return "Esa clave no funcionó. Cópiala de nuevo en Fathom (Settings › API Access) y pégala aquí.";
  }
  return "No pude hablar con Fathom. Prueba de nuevo en un rato.";
}

async function deleteOurs(
  clientFor: (k: string) => FathomClient,
  stored: { apiKeyEnc: string; webhookId: string | null; webhookUrl: string | null } | null,
  baseUrl: string,
) {
  if (!stored || !isOurWebhook(stored, baseUrl)) return false;
  try {
    await clientFor(decryptSecret(stored.apiKeyEnc)).deleteWebhook(stored.webhookId!);
    return true;
  } catch {
    // the old key may be revoked; Fathom stops on its own when our URL answers 404
    return false;
  }
}

export async function connectFathom(
  db: PrismaClient,
  userId: string,
  rawKey: string,
  deps: ConnectDeps,
): Promise<{ ok: true; webhook: boolean } | { ok: false; error: string }> {
  const apiKey = rawKey.trim();
  if (apiKey.length < 10 || apiKey.length > 300 || /\s/.test(apiKey)) {
    return { ok: false, error: "Pega la clave de Fathom completa (Settings › API Access)." };
  }
  const createHook = deps.webhooks ?? webhooksEnabled();
  const production = deps.production ?? process.env.NODE_ENV === "production";
  if (createHook && production && !isPublicHttpsUrl(deps.baseUrl)) {
    return { ok: false, error: "La app todavía no tiene su dirección pública configurada. Avísale a soporte." };
  }
  const clientFor = deps.clientFor ?? ((key: string) => fathomClient(key));
  const client = clientFor(apiKey);
  try {
    await client.checkKey();
  } catch (error) {
    return { ok: false, error: fathomMessage(error) };
  }
  let webhook: WebhookFields | "keep" = "keep";
  if (createHook) {
    const old = await readFathomConnection(db, userId);
    // only the webhook this deployment created; a foreign one (other host) is left intact
    await deleteOurs(clientFor, old, deps.baseUrl);
    const token = randomBytes(24).toString("base64url");
    const url = webhookUrl(deps.baseUrl, token);
    try {
      const hook = await client.createWebhook(url);
      webhook = { id: hook.id, secret: hook.secret, token, url };
    } catch (error) {
      return { ok: false, error: fathomMessage(error) };
    }
  }
  await saveFathomConnection(db, userId, { apiKey, webhook }, { revalidate: deps.revalidate, now: deps.now });
  return { ok: true, webhook: webhook !== "keep" };
}

export async function disconnectFathomFlow(
  db: PrismaClient,
  userId: string,
  deps: Pick<ConnectDeps, "clientFor" | "revalidate" | "baseUrl">,
) {
  const old = await readFathomConnection(db, userId);
  await deleteOurs(deps.clientFor ?? ((k: string) => fathomClient(k)), old, deps.baseUrl);
  return disconnectFathom(db, userId, { revalidate: deps.revalidate });
}
