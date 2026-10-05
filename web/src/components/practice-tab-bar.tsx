"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { AppShell, MobileTabBar } from "@/components/app-shell";
import { useConnection } from "@/hooks/use-connection";
import { showPracticeTabBar } from "@/lib/mobile-nav";

/** Same chrome as Inicio. The phone tabs hide while a practice session is live. */
export function PracticeShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { status } = useSession();
  const { phase, shouldConnect, isConnecting } = useConnection();
  const [showCrm, setShowCrm] = useState<boolean | null>(null);
  const visible =
    status === "authenticated" && showPracticeTabBar({ phase, shouldConnect, isConnecting });

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/workspace?view=nav")
      .then((response) => response.json())
      .then((payload) => {
        if (typeof payload.showCrm === "boolean") setShowCrm(payload.showCrm);
      })
      .catch(() => undefined);
  }, [status, path]);

  return (
    <AppShell
      wide
      fill
      reserveTabs={visible}
      tabBar={visible ? <MobileTabBar path={path} showCrm={showCrm} /> : null}
    >
      {children}
    </AppShell>
  );
}
