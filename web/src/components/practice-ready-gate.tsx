"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export function PracticeReadyGate() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login?mode=register&callbackUrl=/setup");
      return;
    }
    if (status !== "authenticated") return;
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((data) => {
        if (!data.canPractice && !data.ready) router.replace("/setup");
      })
      .catch(() => router.replace("/setup"));
  }, [status, router]);

  return null;
}
