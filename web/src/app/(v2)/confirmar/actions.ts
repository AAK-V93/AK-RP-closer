"use server";
// «Llamadas por confirmar»: one tap = confirmCall (lib/write/confirm.ts),
// «Deshacer» = undoProposedChange, «No era interna» = recoverIgnoredCall.
// The cards saved in this visit ride in the URL (?hechas=) so they stay green.
import { redirect } from "next/navigation";
import { isOutcome } from "@/lib/confirm/choice";
import { getPrisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { type PaymentMode, confirmCall, undoProposedChange } from "@/lib/write/confirm";
import { recoverIgnoredCall } from "@/lib/write/ingest";

function db() {
  const prisma = getPrisma();
  if (!prisma) throw new Error("DATABASE_URL no está configurada");
  return prisma;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const idList = (raw: string) => raw.split(",").filter((id) => /^[\w-]{1,64}$/.test(id)).slice(-10);

function back(params: Record<string, string>, anchor = ""): never {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  redirect(`/confirmar${q.size ? `?${q}` : ""}${anchor ? `#${anchor}` : ""}`);
}

export async function confirmAction(form: FormData) {
  const user = await requireUserId("/confirmar");
  const callId = str(form, "callId");
  const outcome = str(form, "outcome");
  const done = idList(str(form, "hechas"));
  const who = str(form, "who");
  if (!isOutcome(outcome)) back({ hechas: done.join(","), error: "Elige qué pasó en la llamada." });
  // «Cerró» first asks for the amount and how they pay (with «No sé todavía»)
  if (outcome === "CERRO" && str(form, "step") !== "deal") {
    back({ hechas: done.join(","), cerro: callId, quien: who, nombre: str(form, "name") }, `c-${callId}`);
  }
  const mode = str(form, "paymentMode");
  const result = await confirmCall(db(), user.id, {
    callId,
    version: str(form, "version"),
    outcome,
    who,
    name: str(form, "name"),
    deal: outcome === "CERRO"
      ? {
          amountTotal: str(form, "amountTotal"),
          cashCollected: str(form, "cashCollected"),
          paymentMode: mode === "CONTADO" || mode === "CUOTAS" ? (mode as PaymentMode) : null,
        }
      : null,
  });
  if (!result.ok) {
    back(
      { hechas: done.join(","), error: result.error, ...(outcome === "CERRO" ? { cerro: callId, quien: who } : {}) },
      `c-${callId}`,
    );
  }
  back({ hechas: [...done.filter((id) => id !== callId), callId].join(",") }, `c-${callId}`);
}

export async function undoAction(form: FormData) {
  const user = await requireUserId("/confirmar");
  const callId = str(form, "callId");
  const done = idList(str(form, "hechas")).filter((id) => id !== callId);
  const result = await undoProposedChange(db(), user.id, str(form, "changeId"));
  if (!result.ok) back({ hechas: done.join(","), error: result.error });
  back({ hechas: done.join(","), ok: "Listo, lo deshice. La llamada volvió a la lista." }, `c-${callId}`);
}

export async function recoverAction(form: FormData) {
  const user = await requireUserId("/confirmar");
  const callId = str(form, "callId");
  const done = idList(str(form, "hechas"));
  const result = await recoverIgnoredCall(db(), user.id, callId);
  if (!result.ok) back({ hechas: done.join(","), ignoradas: "1", error: result.error });
  back({ hechas: done.join(","), ignoradas: "1", ok: "Volvió a la lista para confirmar." }, `c-${callId}`);
}
