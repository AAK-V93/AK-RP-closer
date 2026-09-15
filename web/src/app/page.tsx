"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { HomeScreen } from "@/components/home-screen";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const { status } = useSession();

  return (
    <AppShell>
      {status === "authenticated" ? (
        <HomeScreen />
      ) : status === "unauthenticated" ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-light">Entrena con tus llamadas reales</h1>
            <p className="text-sm text-fg3">
              Conectas Fathom o subes transcripts. El bot emula a tus leads, el
              coach te corrige y el CRM te dice con quién quedar.
            </p>
          </div>
          <Button asChild variant="primary">
            <Link href="/login?mode=register&callbackUrl=/">Empezar</Link>
          </Button>
        </div>
      ) : (
        <p className="text-sm text-fg3">Cargando…</p>
      )}
    </AppShell>
  );
}
