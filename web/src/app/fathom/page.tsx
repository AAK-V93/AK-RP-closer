"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { AuthMenu } from "@/components/auth-menu";
import { FathomSyncPanel } from "@/components/fathom-sync-panel";

export default function FathomPage() {
  const { status } = useSession();

  return (
    <div className="min-h-screen bg-bg0 flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 md:px-8 py-4 border-b border-separator1">
        <Link href="/" className="text-lg font-light">
          Closer Trainer
        </Link>
        <AuthMenu />
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto p-4 md:p-8 space-y-8">
        <div className="space-y-3">
          <h1 className="text-2xl font-light">Conecta tu cuenta de Fathom</h1>
          <p className="text-sm text-fg3">
            Traemos tus llamadas, las auditamos y las usamos para que el
            prospecto de voz emule a tus leads. También alimentan al coach.
          </p>
        </div>

        <ol className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4 text-sm text-fg2 list-decimal list-inside">
          <li>
            Entra con tu cuenta de Closer Trainer{" "}
            {status !== "authenticated" && (
              <Link href="/login?callbackUrl=/fathom" className="underline">
                (iniciar sesión)
              </Link>
            )}
            .
          </li>
          <li>
            En Fathom abre{" "}
            <a
              href="https://fathom.video/settings/api"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Settings → API
            </a>{" "}
            y crea una API key.
          </li>
          <li>Pégala abajo y pulsa <strong>Conectar Fathom</strong>.</li>
          <li>
            Elige desde qué fecha importar (por defecto, 30 días). Así no
            arrastramos años de Fathom.
          </li>
          <li>
            Pulsa <strong>Importar, auditar y generar estrategia</strong>. Las
            Impromptu cuentan: sacamos lead y oferta del transcript. Solo se
            omiten las que no tienen audio.
          </li>
          <li>
            Cuando termine, abre{" "}
            <Link href="/coach" className="underline">
              Mi coaching
            </Link>{" "}
            para ver la estrategia y seguir entrenando.
          </li>
        </ol>

        <FathomSyncPanel authenticated={status === "authenticated"} embedded />
      </main>
    </div>
  );
}
