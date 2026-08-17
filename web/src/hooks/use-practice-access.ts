"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export const REGISTER_AFTER_FREE_URL =
  "/login?mode=register&reason=free-used&callbackUrl=/practicar";

export type PracticeAccess = {
  allowed: boolean;
  remaining: number | null;
  used: boolean;
  authenticated: boolean;
};

export function usePracticeAccess() {
  const { status } = useSession();
  const [access, setAccess] = useState<PracticeAccess | null>(null);

  const refresh = useCallback(async () => {
    if (status === "authenticated") {
      setAccess({
        allowed: true,
        remaining: null,
        used: false,
        authenticated: true,
      });
      return;
    }
    if (status !== "unauthenticated") return;
    try {
      const response = await fetch("/api/practice-access");
      const data = await response.json();
      setAccess({
        allowed: Boolean(data.allowed),
        remaining: typeof data.remaining === "number" ? data.remaining : 0,
        used: Boolean(data.used),
        authenticated: false,
      });
    } catch {
      setAccess({
        allowed: true,
        remaining: 1,
        used: false,
        authenticated: false,
      });
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { access, status, refresh };
}
