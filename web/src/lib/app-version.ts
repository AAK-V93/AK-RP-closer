/** Build id baked in at build time (next.config env). Same value in the page and in /api/version. */
export const CURRENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "";

/** At most one check per minute (focus, tab back, or the 5-minute timer). */
export const VERSION_CHECK_MIN_MS = 60_000;
export const VERSION_CHECK_EVERY_MS = 5 * 60_000;

export function shouldCheckVersion(lastCheckedAt: number, now: number) {
  return now - lastCheckedAt >= VERSION_CHECK_MIN_MS;
}

/** A newer deploy answers with a different build id. Unknown ids (dev, errors) never nag. */
export function isNewerBuild(current: string, remote: unknown) {
  const live = typeof remote === "string" ? remote.trim() : "";
  return Boolean(current && live && live !== current && !live.startsWith("local-") && !current.startsWith("local-"));
}

export const NEW_VERSION_TEXT = "Hay una versión nueva";
export const RELOAD_TEXT = "Recargar";
