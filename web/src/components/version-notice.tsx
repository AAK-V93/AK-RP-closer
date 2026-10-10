"use client";

import { useEffect, useRef, useState } from "react";
import {
  CURRENT_BUILD_ID,
  NEW_VERSION_TEXT,
  RELOAD_TEXT,
  VERSION_CHECK_EVERY_MS,
  isNewerBuild,
  shouldCheckVersion,
} from "@/lib/app-version";

/**
 * «Hay una versión nueva · Recargar». A tab opened before a deploy keeps the old build until
 * it reloads; this tells the closer, without blocking anything. One tiny request on focus or
 * every 5 minutes while the tab is visible.
 */
export function VersionNotice() {
  const [fresh, setFresh] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastCheck = useRef(0);

  useEffect(() => {
    if (!CURRENT_BUILD_ID) return;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!shouldCheckVersion(lastCheck.current, now)) return;
      lastCheck.current = now;
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json().catch(() => ({}))) as { build?: unknown };
        if (!stopped && isNewerBuild(CURRENT_BUILD_ID, data.build)) setFresh(true);
      } catch {
        // Offline or a deploy in progress: try again later.
      }
    };
    lastCheck.current = Date.now();
    const timer = window.setInterval(() => void check(), VERSION_CHECK_EVERY_MS);
    const onVisible = () => void check();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!fresh || hidden) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-[calc(0.5rem+env(safe-area-inset-top))] z-[60] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-separator2 bg-bg0 py-1 pl-4 pr-1 text-sm text-fg0 shadow-md"
    >
      <span>{NEW_VERSION_TEXT}</span>
      <span aria-hidden className="text-fg3">·</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex min-h-11 items-center rounded-full px-3 font-medium underline"
      >
        {RELOAD_TEXT}
      </button>
      <button
        type="button"
        aria-label="Cerrar aviso de versión nueva"
        onClick={() => setHidden(true)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full text-fg3"
      >
        ×
      </button>
    </div>
  );
}
