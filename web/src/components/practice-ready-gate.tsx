"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function PracticeReadyGate() {
  const { status } = useSession();
  const router = useRouter();
  const [blocked, setBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login?mode=register&callbackUrl=/practicar");
      return;
    }
    if (status !== "authenticated") return;
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((data) => {
        setBlocked(!data.canPractice);
      })
      .catch(() => setBlocked(true));
  }, [status, router]);

  if (status === "unauthenticated") return null;
  if (status === "loading" || blocked === null) {
    return (
      <div className="fixed inset-0 z-50 bg-bg0" aria-hidden />
    );
  }
  if (!blocked) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg0 px-6">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-[11px] uppercase tracking-wide text-fg3">Práctica</p>
        <h1 className="text-2xl font-light">Necesitas una oferta para practicar</h1>
        <p className="text-sm text-fg3">
          Pon por lo menos una oferta — qué vendes, a quién y a qué precio — y
          ya puedes entrar al roleplay. Sin eso el agente no sabe de qué
          hablar.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button asChild variant="primary">
            <Link href="/ofertas">Ir a Ofertas</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Volver a Inicio</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
