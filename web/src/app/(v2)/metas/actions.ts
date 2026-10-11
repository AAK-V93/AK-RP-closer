"use server";
// Server Actions of Metas: session → lib/write (single statements, cache
// tags invalidated there) → back to the page with a banner.
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { metasView, pathKey, toChosenPath } from "@/lib/metrics";
import { readGoals } from "@/lib/read/goals";
import { readOfferMap } from "@/lib/read/offers";
import { readUserSettings } from "@/lib/read/user";
import { requireUserId } from "@/lib/session";
import { bogotaDay } from "@/lib/time/bogota";
import { chooseGoalPath, setGoal, setWeeklyGoal } from "@/lib/write/goals";

function db() {
  const prisma = getPrisma();
  if (!prisma) throw new Error("DATABASE_URL no está configurada");
  return prisma;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function back(extra: Record<string, string> = {}): never {
  const q = new URLSearchParams(extra).toString();
  redirect(`/metas${q ? `?${q}` : ""}`);
}

export async function setGoalAction(form: FormData) {
  const user = await requireUserId("/metas");
  // an «Ideas» chip sends its amount in «idea»; otherwise the typed amount
  const amount = str(form, "idea") || str(form, "amount");
  const res = await setGoal(db(), user.id, { amount });
  if (!res.ok) back({ error: res.error, ...(str(form, "from") === "edit" ? { editar: "1" } : {}) });
  back({ ok: str(form, "from") === "edit" ? "Listo, cambié tu meta. Tu camino ya está recalculado." : "Listo, ya tienes tu meta del mes." });
}

/** Recomputes the paths from fresh rows (no cache) and stores the one picked. */
export async function choosePathAction(form: FormData) {
  const user = await requireUserId("/metas");
  const key = str(form, "path");
  const now = new Date();
  const today = bogotaDay(now);
  const settings = await readUserSettings(db(), user.id);
  const [data, offers] = await Promise.all([readGoals(db(), user.id, today, settings.currency), readOfferMap(db(), user.id)]);
  const view = metasView(data, offers, settings.currency, now);
  const path = view.goal?.paths.find((p) => pathKey(p) === key);
  if (!path) back({ error: "Ese camino ya cambió. Elige de nuevo." });
  const res = await chooseGoalPath(db(), user.id, toChosenPath(path, now), { now });
  if (!res.ok) back({ error: res.error });
  back({ ok: "Listo, ese es tu camino." });
}

export async function setWeekAction(form: FormData) {
  const user = await requireUserId("/metas");
  const res = await setWeeklyGoal(db(), user.id, {
    meetingsTarget: str(form, "meetingsTarget"),
    followupsTarget: str(form, "followupsTarget"),
  });
  if (!res.ok) back({ error: res.error, semana: "1" });
  back({ ok: "Listo, guardé tu meta de esta semana." });
}
