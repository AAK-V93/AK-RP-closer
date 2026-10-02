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
            <h1 className="font-display text-4xl text-fg0">Entrena con tus llamadas reales</h1>
            <p className="text-sm text-fg3">
              Conectas tus grabaciones o subes transcripciones. El agente de voz de práctica
              emula a tus prospectos, el coach te corrige y el CRM te dice con quién
              quedar.
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
