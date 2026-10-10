/**
 * «Seguimiento 4 de 10»: how many follow-up attempts the closer made since the
 * person's last call. Kali's rule (oct 2026):
 * - Every «Hecho» and every «No contestó» counts as one attempt.
 * - A new call resets the count to 0.
 * - Cerrados and perdidos have no stage.
 * The target lives here so it can later come from each offer.
 */
export const DEFAULT_FOLLOWUP_TARGET = 10;

/** One place to read the target. Pass an offer value later; today everyone gets 10. */
export function followupTarget(offerTarget?: number | null) {
  const value = Math.trunc(Number(offerTarget));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_FOLLOWUP_TARGET;
}

export type StageAttempt = {
  /** When the closer marked it. */
  at: Date | string | null | undefined;
  /** «hecho», «no_contesto» (or «no_contestó»). Anything else is not an attempt. */
  resultado: string | null | undefined;
};

export type StageInput = {
  /** Lead status or the outcome bucket. «cerrado», «perdido», «ganado»… end the stage. */
  status?: string | null;
  /** Dates of the person's real calls. The newest one resets the count. */
  callDates: (Date | string | null | undefined)[];
  /** Resolved follow-ups (alerts or touches) with their result. */
  attempts: StageAttempt[];
  /**
   * What the last call itself remembers when there is no dated alert:
   * `contactos` counts only Hecho / No contestó clicks (seguimiento_contactos), and
   * `resultado` is the latest result. The older `seguimiento_intentos` counter is NOT
   * used: it also went up on «no se presentó» and «reprogramado».
   * Counted only when the dated attempts are fewer, so one click is never counted twice.
   */
  lastCallAttempts?: { contactos?: number | null; resultado?: string | null } | null;
  target?: number | null;
};

export type FollowupStage = {
  count: number;
  target: number;
  label: string;
};

const ATTEMPT = new Set(["hecho", "no_contesto"]);
const ENDED = /^(cerrad|ganad|perdid|cierre venta|cerro|cerró|lost|won)/i;

function foldResult(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function time(value: Date | string | null | undefined) {
  if (!value) return NaN;
  const at = value instanceof Date ? value : new Date(value);
  return at.getTime();
}

export function isAttempt(resultado: string | null | undefined) {
  return ATTEMPT.has(foldResult(resultado));
}

/** «Sin seguimiento aún» at 0, «Seguimiento 4 de 10» after. Null for cerrados and perdidos. */
export function stageLabel(count: number, target: number) {
  if (count <= 0) return "Sin seguimiento aún";
  return `Seguimiento ${count} de ${target}`;
}

export function followupStage(input: StageInput): FollowupStage | null {
  if (ENDED.test(String(input.status || "").trim())) return null;
  const target = followupTarget(input.target);
  const lastCall = input.callDates.map(time).filter(Number.isFinite).reduce((max, at) => Math.max(max, at), -Infinity);
  const dated = input.attempts.filter((row) => {
    if (!isAttempt(row.resultado)) return false;
    const at = time(row.at);
    if (!Number.isFinite(at)) return false;
    return !Number.isFinite(lastCall) || at > lastCall;
  }).length;
  const stored = Math.max(0, Math.trunc(Number(input.lastCallAttempts?.contactos) || 0));
  // Old calls have no real-attempt counter yet: their latest result still counts once.
  const onCall = input.lastCallAttempts
    ? Math.max(stored, isAttempt(input.lastCallAttempts.resultado) ? 1 : 0)
    : 0;
  const count = Math.max(dated, onCall);
  return { count, target, label: stageLabel(count, target) };
}
