"use server";
// «Tus llamadas» in Mis ofertas: connect/disconnect Fathom, upload a call,
// retry failed briefs. Session → lib/ingest (writes go through lib/write) → back.
import { after } from "next/server";
import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { BACKFILL_WINDOW_DAYS, runBackfillBurst } from "@/lib/ingest/backfill";
import { connectFathom, disconnectFathomFlow } from "@/lib/ingest/connect";
import { retryFailedBriefs } from "@/lib/ingest/retry";
import { uploadCall } from "@/lib/ingest/upload";
import { getPrisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";

function db() {
  const prisma = getPrisma();
  if (!prisma) throw new Error("DATABASE_URL no está configurada");
  return prisma;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function back(extra: Record<string, string>): never {
  redirect(`/ofertas?${new URLSearchParams(extra).toString()}#llamadas`);
}

export async function connectFathomAction(form: FormData) {
  const user = await requireUserId("/ofertas");
  const prisma = db();
  const result = await connectFathom(prisma, user.id, str(form, "apiKey"), { baseUrl: appUrl() });
  if (!result.ok) back({ error: result.error, llamadas: "conectar" });
  // first burst of the rebuild right after the response; the rest on each visit to Hoy
  after(async () => {
    try {
      await runBackfillBurst(prisma, user.id);
    } catch (error) {
      console.warn("[fathom] first burst failed:", error instanceof Error ? error.message.slice(0, 160) : "unknown");
    }
  });
  back({ ok: `Fathom quedó conectado. Estoy trayendo tus llamadas de los últimos ${BACKFILL_WINDOW_DAYS} días.` });
}

export async function disconnectFathomAction() {
  const user = await requireUserId("/ofertas");
  await disconnectFathomFlow(db(), user.id);
  back({ ok: "Fathom quedó desconectado. Tus llamadas ya traídas se quedan." });
}

export async function uploadCallAction(form: FormData) {
  const user = await requireUserId("/ofertas");
  const file = form.get("file");
  const result = await uploadCall(db(), user.id, {
    file: file instanceof File ? file : null,
    text: String(form.get("text") ?? ""),
    title: str(form, "title"),
    date: str(form, "date"),
  });
  if (!result.ok) back({ error: result.error, llamadas: "subir" });
  const ok = {
    READY: "Listo: la llamada está esperando que la confirmes.",
    IGNORED: "La guardé, pero no parece una llamada de venta, así que no te pide confirmar nada.",
    BRIEF_FAILED: "La guardé, pero no pude resumirla. Toca «Reintentar» en un rato.",
    DUPLICATE: "Esa llamada ya estaba subida.",
  }[result.status];
  back({ ok });
}

export async function retryBriefsAction() {
  const user = await requireUserId("/ofertas");
  const r = await retryFailedBriefs(db(), user.id);
  if (r.tried === 0) back({ ok: "No hay llamadas por resumir." });
  if (r.fixed === r.tried) back({ ok: r.fixed === 1 ? "Listo: resumí la llamada." : `Listo: resumí ${r.fixed} llamadas.` });
  back({ error: "Todavía no pude resumir algunas llamadas. Prueba de nuevo en un rato." });
}
