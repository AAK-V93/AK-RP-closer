/**
 * Small rules that keep the database (Neon Free: it sleeps after ~5 min without queries)
 * from being woken up when nothing useful would come out of it.
 */

/** Llamadas: after «nothing left to file», don't ask again for 10 minutes in this tab. */
export const CLASSIFY_DONE_KEY = "llamadas:classify-done-at";
export const CLASSIFY_QUIET_MS = 10 * 60_000;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** pendingKey = the unfiled calls when the server said «done»; a new call asks again right away. */
export function classifyRecentlyDone(storage: StorageLike | null | undefined, now: number, pendingKey = "") {
  try {
    const raw = storage?.getItem(CLASSIFY_DONE_KEY) || "";
    const cut = raw.indexOf("|");
    const at = Number(cut >= 0 ? raw.slice(0, cut) : raw) || 0;
    const key = cut >= 0 ? raw.slice(cut + 1) : "";
    return at > 0 && now - at < CLASSIFY_QUIET_MS && key === pendingKey;
  } catch {
    return false;
  }
}

export function rememberClassifyDone(storage: StorageLike | null | undefined, now: number, pendingKey = "") {
  try {
    storage?.setItem(CLASSIFY_DONE_KEY, `${now}|${pendingKey}`);
  } catch {
    /* private mode */
  }
}

/**
 * Push reminders are not sent at night (22:00–07:00 in the closer's zone, Bogotá/Lima),
 * so the push job does not wake the database then. Due alerts go out at 7:00.
 */
export const PUSH_QUIET_FROM = 22;
export const PUSH_QUIET_TO = 7;
export const PUSH_TIMEZONE = "America/Bogota";

export function pushQuietHours(now: Date, timeZone = PUSH_TIMEZONE) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now),
  );
  return hour >= PUSH_QUIET_FROM || hour < PUSH_QUIET_TO;
}
