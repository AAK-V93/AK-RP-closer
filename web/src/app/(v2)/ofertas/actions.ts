"use server";
// Server Actions of Mis ofertas: session → lib/write (which recounts and
// invalidates the cache tags) → back to the page.
import { redirect } from "next/navigation";
import type { CommissionType, ScriptOrigin } from "@prisma/client";
import { driveTokenFor } from "@/lib/cases/drive-token";
import { getPrisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { type ReviewItem, type SyncDeps, addCaseSources, addDriveSheet, addManualCase, saveCaseReview, syncCaseSource } from "@/lib/write/cases";
import { archiveOffer, deleteScript, upsertOffer, upsertScript } from "@/lib/write/offers";

/** Reading links stops starting new ones after this; the rest wait for «Leer ahora». */
const SYNC_BUDGET_MS = 20_000;

function db() {
  const prisma = getPrisma();
  if (!prisma) throw new Error("DATABASE_URL no está configurada");
  return prisma;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const TABS = new Set(["precios", "comision", "guiones", "casos"]);

function back(offerId: string | null, tab: string | null, extra: Record<string, string> = {}): never {
  const q = new URLSearchParams();
  if (offerId) q.set("oferta", offerId);
  if (tab && TABS.has(tab)) q.set("tab", tab);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  redirect(`/ofertas${s ? `?${s}` : ""}`);
}

function syncDeps(userId: string): SyncDeps {
  return {
    driveToken: () => driveTokenFor(db(), userId),
    youtubeKey: process.env.YOUTUBE_API_KEY?.trim() || null,
  };
}

export type OfferFormState = { error: string | null };

export async function saveOfferAction(_prev: OfferFormState, form: FormData): Promise<OfferFormState> {
  const user = await requireUserId("/ofertas");
  const type = str(form, "commissionType");
  const count = str(form, "installmentsCount");
  const result = await upsertOffer(db(), user.id, {
    id: str(form, "id") || null,
    name: str(form, "name"),
    description: str(form, "description"),
    currency: str(form, "currency") || "USD",
    priceCash: str(form, "priceCash"),
    installmentsCount: count ? Number(count) : null,
    installmentAmount: str(form, "installmentAmount"),
    commissionType: (["PER_CLOSE", "PCT_SALE", "PCT_CASH"].includes(type) ? type : null) as CommissionType | null,
    commissionValue: str(form, "commissionValue"),
  });
  if (!result.ok) return { error: result.error };
  back(result.id, str(form, "tab") || "precios", { ok: "Guardado." });
}

export async function archiveOfferAction(form: FormData) {
  const user = await requireUserId("/ofertas");
  const r = await archiveOffer(db(), user.id, str(form, "id"));
  back(null, null, r.ok ? { ok: "Archivaste la oferta." } : { error: r.error });
}

export async function saveScriptAction(form: FormData) {
  const user = await requireUserId("/ofertas");
  const offerId = str(form, "offerId");
  const origin = str(form, "origin");
  const r = await upsertScript(db(), user.id, {
    id: str(form, "id") || null,
    offerId: offerId || null,
    title: str(form, "title"),
    body: str(form, "body"),
    origin: (["EMPRESA", "APP", "PROPIO"].includes(origin) ? origin : undefined) as ScriptOrigin | undefined,
  });
  back(offerId, "guiones", r.ok ? { ok: "Guion guardado." } : { error: r.error });
}

export async function deleteScriptAction(form: FormData) {
  const user = await requireUserId("/ofertas");
  const r = await deleteScript(db(), user.id, str(form, "id"));
  back(str(form, "offerId"), "guiones", r.ok ? { ok: "Borraste el guion." } : { error: r.error });
}

function syncMessage(results: Array<{ found: number; added: number; status: string; message: string | null }>, pending: number) {
  const problems = results.filter((r) => r.status !== "READY").map((r) => r.message).filter(Boolean);
  const added = results.reduce((n, r) => n + r.added, 0);
  const parts: string[] = [];
  if (added) parts.push(`Encontré ${added} ${added === 1 ? "caso nuevo" : "casos nuevos"}. Revísalos antes de usarlos.`);
  else if (results.some((r) => r.status === "READY")) parts.push("No encontré casos nuevos.");
  if (pending) parts.push(`Quedan ${pending} ${pending === 1 ? "enlace" : "enlaces"} por leer: pulsa «Leer ahora».`);
  return { ok: parts.join(" "), error: problems.join(" ") };
}

export async function addLinksAction(form: FormData) {
  const user = await requireUserId("/ofertas");
  const offerId = str(form, "offerId");
  const added = await addCaseSources(db(), user.id, offerId, str(form, "links"));
  if (!added.ok) back(offerId, "casos", { error: added.error });
  const started = Date.now();
  const results = [];
  let pending = 0;
  for (const id of added.added) {
    if (Date.now() - started > SYNC_BUDGET_MS) {
      pending += 1;
      continue;
    }
    const r = await syncCaseSource(db(), user.id, id, syncDeps(user.id));
    if (r.ok) results.push(r.result);
  }
  const msg = syncMessage(results, pending);
  const invalid = added.invalid.map((i) => `${i.rawUrl}: ${i.reason}.`).join(" ");
  const error = [msg.error, invalid].filter(Boolean).join(" ");
  back(offerId, "casos", { ...(msg.ok ? { ok: msg.ok } : {}), ...(error ? { error } : {}) });
}

export async function syncSourceAction(form: FormData) {
  const user = await requireUserId("/ofertas");
  const offerId = str(form, "offerId");
  const r = await syncCaseSource(db(), user.id, str(form, "id"), syncDeps(user.id));
  if (!r.ok) back(offerId, "casos", { error: r.error });
  const msg = syncMessage([r.result], 0);
  back(offerId, "casos", { ...(msg.ok ? { ok: msg.ok } : {}), ...(msg.error ? { error: msg.error } : {}) });
}

/** Called from the Drive Picker with the file the person chose. */
export async function addDriveSheetAction(offerId: string, file: { id: string; name: string | null; url: string | null }) {
  const user = await requireUserId("/ofertas");
  const added = await addDriveSheet(db(), user.id, offerId, file);
  if (!added.ok) return { ok: false as const, error: added.error };
  const r = await syncCaseSource(db(), user.id, added.id, syncDeps(user.id));
  if (!r.ok) return { ok: false as const, error: r.error };
  const msg = syncMessage([r.result], 0);
  return { ok: true as const, message: msg.ok, error: msg.error };
}

const REVIEW_FIELDS = ["name", "profile", "before", "result", "quote", "mediaUrl"] as const;

export async function saveReviewAction(form: FormData) {
  const user = await requireUserId("/ofertas");
  const offerId = str(form, "offerId");
  const ids = form.getAll("caseId").map(String);
  const items: ReviewItem[] = ids.map((id) => {
    const decision = str(form, `${id}.decision`);
    const item: ReviewItem = { id, decision: decision === "confirm" || decision === "dismiss" ? decision : "keep" };
    for (const f of REVIEW_FIELDS) if (form.has(`${id}.${f}`)) item[f] = String(form.get(`${id}.${f}`) ?? "");
    return item;
  });
  const r = await saveCaseReview(db(), user.id, offerId, items);
  if (!r.ok) back(offerId, "casos", { error: r.error });
  const parts = [];
  if (r.confirmed) parts.push(`${r.confirmed} ${r.confirmed === 1 ? "caso listo" : "casos listos"} para sugerir.`);
  if (r.dismissed) parts.push(`${r.dismissed} ${r.dismissed === 1 ? "descartado" : "descartados"}.`);
  back(offerId, "casos", { ok: parts.join(" ") || "Guardado." });
}

export async function addManualCaseAction(form: FormData) {
  const user = await requireUserId("/ofertas");
  const offerId = str(form, "offerId");
  const r = await addManualCase(db(), user.id, offerId, {
    name: str(form, "name"),
    profile: str(form, "profile") || null,
    before: str(form, "before") || null,
    result: str(form, "result") || null,
    quote: str(form, "quote") || null,
    mediaUrl: str(form, "mediaUrl") || null,
  });
  back(offerId, "casos", r.ok ? { ok: "Caso agregado." } : { error: r.error });
}
