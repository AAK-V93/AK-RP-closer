"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export function PracticeReadyGate() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login?mode=register&callbackUrl=/ofertas");
      return;
    }
    if (status !== "authenticated") return;
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((data) => {
        if (!data.canPractice && !data.hasAnyOffer && !data.ready) router.replace("/");
      })
      .catch(() => router.replace("/"));
  }, [status, router]);

  return null;
}
