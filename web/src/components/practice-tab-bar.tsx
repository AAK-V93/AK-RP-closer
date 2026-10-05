"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { MobileTabBar } from "@/components/app-shell";
import { useConnection } from "@/hooks/use-connection";
import { showPracticeTabBar } from "@/lib/mobile-nav";

/** Same phone tabs as the rest of the app. Hidden while a practice session is live. */
export function PracticeTabBar() {
  const path = usePathname();
  const { status } = useSession();
  const { phase, shouldConnect, isConnecting } = useConnection();
  const [showCrm, setShowCrm] = useState(false);
  const visible = showPracticeTabBar({ phase, shouldConnect, isConnecting });

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/workspace?view=nav")
      .then((response) => response.json())
      .then((payload) => {
        if (typeof payload.showCrm === "boolean") setShowCrm(payload.showCrm);
      })
      .catch(() => undefined);
  }, [status, path]);

  if (status !== "authenticated" || !visible) return null;
  return <MobileTabBar path={path} showCrm={showCrm} />;
}
