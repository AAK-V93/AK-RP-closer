// «Conectar Fathom» / «Desconectar» (plan 2.6). Checks the key with one light
// request, replaces any old webhook, creates ours (summary + action items +
// transcript) to a per-user URL, saves everything encrypted and starts the
// rebuild. Kali's real key is never used in tests: the client is injected.
import { randomBytes } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { isPublicHttpsUrl } from "@/lib/app-url";
import { readFathomConnection } from "@/lib/read/fathom";
import { decryptSecret } from "@/lib/secret-crypto";
import { disconnectFathom, saveFathomConnection } from "@/lib/write/ingest";
import type { WriteOpts } from "@/lib/write/offers";
import { type FathomClient, FathomError, FathomRateLimited, fathomClient } from "./fathom-api";

export type ConnectDeps = {
  clientFor?: (apiKey: string) => FathomClient;
  /** public base URL of the app (appUrl()) */
  baseUrl: string;
  production?: boolean;
  revalidate?: WriteOpts["revalidate"];
  now?: Date;
};

export function webhookUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/fathom/webhook/${token}`;
}

function fathomMessage(error: unknown) {
  if (error instanceof FathomRateLimited) return "Fathom está ocupado. Prueba de nuevo en un minuto.";
  if (error instanceof FathomError && (error.status === 401 || error.status === 403)) {
    return "Esa clave no funcionó. Cópiala de nuevo en Fathom (Settings › API Access) y pégala aquí.";
  }
  return "No pude hablar con Fathom. Prueba de nuevo en un rato.";
}

export async function connectFathom(
  db: PrismaClient,
  userId: string,
  rawKey: string,
  deps: ConnectDeps,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = rawKey.trim();
  if (apiKey.length < 10 || apiKey.length > 300 || /\s/.test(apiKey)) {
    return { ok: false, error: "Pega la clave de Fathom completa (Settings › API Access)." };
  }
  const production = deps.production ?? process.env.NODE_ENV === "production";
  if (production && !isPublicHttpsUrl(deps.baseUrl)) {
    return { ok: false, error: "La app todavía no tiene su dirección pública configurada. Avísale a soporte." };
  }
  const clientFor = deps.clientFor ?? ((key: string) => fathomClient(key));
  const client = clientFor(apiKey);
  try {
    await client.checkKey();
  } catch (error) {
    return { ok: false, error: fathomMessage(error) };
  }
  // an old webhook (reconnecting) would deliver twice: remove it first, best effort
  const old = await readFathomConnection(db, userId);
  if (old?.webhookId && old.apiKeyEnc) {
    try {
      await clientFor(decryptSecret(old.apiKeyEnc)).deleteWebhook(old.webhookId);
    } catch {
      // the old key may be revoked; Fathom stops on its own when the URL answers 404
    }
  }
  const token = randomBytes(24).toString("base64url");
  let hook: { id: string; secret: string };
  try {
    hook = await client.createWebhook(webhookUrl(deps.baseUrl, token));
  } catch (error) {
    return { ok: false, error: fathomMessage(error) };
  }
  await saveFathomConnection(db, userId, { apiKey, webhookId: hook.id, webhookSecret: hook.secret, webhookToken: token }, {
    revalidate: deps.revalidate,
    now: deps.now,
  });
  return { ok: true };
}

export async function disconnectFathomFlow(
  db: PrismaClient,
  userId: string,
  deps: Pick<ConnectDeps, "clientFor" | "revalidate"> = {},
) {
  const old = await readFathomConnection(db, userId);
  if (old?.webhookId && old.apiKeyEnc) {
    try {
      await (deps.clientFor ?? ((k: string) => fathomClient(k)))(decryptSecret(old.apiKeyEnc)).deleteWebhook(old.webhookId);
    } catch {
      // best effort: the row goes anyway, so the URL answers 404 from now on
    }
  }
  return disconnectFathom(db, userId, { revalidate: deps.revalidate });
}
