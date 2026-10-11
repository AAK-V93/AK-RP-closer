// «Subir una llamada»: a transcript file (.txt, .vtt, .srt) or pasted text.
// Same path as Fathom: ingestCall (stored once, duplicates are a no-op) and the
// brief right away from the text in memory.
import type { PrismaClient } from "@prisma/client";
import { briefIngestedCall, ingestCall } from "@/lib/write/ingest";
import type { WriteOpts } from "@/lib/write/offers";
import { type ModelCall, briefModelAvailable, defaultBriefModel } from "./brief";
import { fromUpload } from "./meeting";

export const UPLOAD_MAX_BYTES = 2_000_000;
const ALLOWED = /\.(txt|vtt|srt|text|md)$/i;

export type UploadForm = { file: File | null; text: string; title: string; date: string };
export type UploadResult =
  | { ok: true; status: "READY" | "BRIEF_FAILED" | "DUPLICATE" | "IGNORED" }
  | { ok: false; error: string };

/** «YYYY-MM-DD» → midday in Bogotá (the call day is what matters) */
export function uploadDate(raw: string, now: Date): Date | null {
  if (!raw) return now;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00-05:00`);
  return Number.isFinite(d.getTime()) && d.getTime() <= now.getTime() + 86_400_000 ? d : null;
}

export async function readUploadText(form: UploadForm): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (form.file && form.file.size > 0) {
    if (form.file.size > UPLOAD_MAX_BYTES) return { ok: false, error: "Ese archivo es muy grande. Sube solo la transcripción (texto)." };
    if (!ALLOWED.test(form.file.name)) {
      return { ok: false, error: "Por ahora sube la transcripción en texto (.txt, .vtt o .srt), o pégala abajo." };
    }
    return { ok: true, text: await form.file.text() };
  }
  if (form.text.trim()) return { ok: true, text: form.text.slice(0, UPLOAD_MAX_BYTES) };
  return { ok: false, error: "Elige el archivo de la transcripción o pégala." };
}

export async function uploadCall(
  db: PrismaClient,
  userId: string,
  form: UploadForm,
  deps: { model?: ModelCall | null; revalidate?: WriteOpts["revalidate"]; now?: Date } = {},
): Promise<UploadResult> {
  const now = deps.now ?? new Date();
  const recordedAt = uploadDate(form.date.trim(), now);
  if (!recordedAt) return { ok: false, error: "Revisa la fecha de la llamada." };
  const read = await readUploadText(form);
  if (!read.ok) return read;
  const input = fromUpload(read.text, { title: form.title, recordedAt }, now);
  if (!input) return { ok: false, error: "No encontré una conversación en ese texto. Revisa que sea la transcripción." };
  const opts = { revalidate: deps.revalidate, now };
  const saved = await ingestCall(db, userId, input, opts);
  if (!saved.ok) return { ok: false, error: saved.error };
  if (!saved.created) return { ok: true, status: "DUPLICATE" };
  const model = deps.model !== undefined ? deps.model : briefModelAvailable() ? defaultBriefModel : null;
  const brief = await briefIngestedCall(db, userId, saved.callId, input, { model }, opts);
  if (!brief.ok) return { ok: true, status: "BRIEF_FAILED" };
  return { ok: true, status: brief.state === "IGNORED" ? "IGNORED" : "READY" };
}
