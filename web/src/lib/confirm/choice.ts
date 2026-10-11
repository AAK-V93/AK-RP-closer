// Confirmar llamadas (PR 6, mockup 04): pure pieces shared by the screen and the
// write. No DB here.
import type { CallBrief, Outcome } from "@/lib/ingest/brief";

export const OUTCOMES = ["CERRO", "SEGUIMIENTO", "PERDIDO", "REAGENDAR"] as const;
export const OUTCOME_LABEL: Record<Outcome, string> = {
  CERRO: "Cerró",
  SEGUIMIENTO: "Sigue en seguimiento",
  PERDIDO: "Perdido",
  REAGENDAR: "Reagendar",
};

/** «Pendiente de pago»: the label comes from the brief (estado_lead), never from the closer's tap. */
export const PENDING_PAYMENT_LABEL = "Pendiente de pago";

export function isOutcome(v: unknown): v is Outcome {
  return typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);
}

/** What «Guardado: …» says after a tap. */
export function savedText(outcome: Outcome, pendingPayment: boolean, noDate = false) {
  if (outcome === "CERRO") return "Guardado: venta cerrada";
  if (outcome === "PERDIDO") return "Guardado: perdido";
  if (outcome === "REAGENDAR") return noDate ? "Guardado: reagendada · sin fecha" : "Guardado: reagendada";
  return pendingPayment ? "Guardado: sigue en seguimiento · pendiente de pago" : "Guardado: sigue en seguimiento";
}

/** A brief date «YYYY-MM-DD…» → the day, or null (nothing invented). */
export function briefDay(raw: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? "");
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}` ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/** Time of day from a brief date «YYYY-MM-DDTHH:mm» (Bogotá local), or null when it has none. */
export function briefTime(raw: string | null | undefined): string | null {
  if (!briefDay(raw)) return null;
  const m = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(raw ?? "");
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  return h < 24 && min < 60 ? `${m[1]}:${m[2]}` : null;
}

/**
 * «Reagendar» without a date (Lead.needsMeetingDate, stored since PR 6). PR 7 list:
 * the ficha and Personas show this label with «Poner fecha».
 */
export const NO_DATE_LABEL = "Reagendar · sin fecha";

/** «Cerró» form defaults, only from amounts the brief cites (parseBrief already nulled the rest). */
export function dealDefaults(brief: Pick<CallBrief, "venta_total" | "cash_collected" | "modo_pago" | "moneda"> | null) {
  const mode = (brief?.modo_pago ?? "").toLowerCase();
  return {
    amountTotal: brief?.venta_total ?? null,
    cashCollected: brief?.cash_collected ?? null,
    paymentMode: /cuota|plazo|financ/.test(mode) ? ("CUOTAS" as const) : /contado|completo|total|unico|único/.test(mode) ? ("CONTADO" as const) : null,
    currency: brief?.moneda ?? null,
  };
}
