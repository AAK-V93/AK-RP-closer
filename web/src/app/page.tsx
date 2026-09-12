import { Metadata } from "next";
import Link from "next/link";
import { PhoneCall, FileSearch, GraduationCap, Link2 } from "lucide-react";
import { AuthMenu } from "@/components/auth-menu";

export const metadata: Metadata = {
  title: "Closer Trainer | Coaching de cierre",
  description:
    "Practica con un prospecto, conecta Fathom, analiza llamadas reales o entra al coach high-ticket.",
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-bg0 flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 md:px-8 py-4 border-b border-separator1">
        <span className="text-lg font-light">Closer Trainer</span>
        <AuthMenu />
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-5xl space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-light">¿Qué quieres hacer?</h1>
            <p className="text-sm text-fg3 max-w-lg mx-auto">
              Elige una. Puedes cambiar después desde Inicio.
            </p>
          </div>

          <Link
            href="/fathom"
            className="group block rounded-2xl border border-primary/25 bg-primary/5 p-5 md:p-6 hover:border-primary/40 hover:bg-primary/10 transition-colors"
          >
            <div className="flex items-start gap-4">
              <Link2 className="h-6 w-6 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="text-xl font-light">Conecta tu cuenta de Fathom</h2>
                <p className="text-sm text-fg3">
                  Importa todas tus llamadas, audítalas automáticamente y recibe
                  la estrategia del coach high-ticket.
                </p>
                <p className="text-xs text-fg2 group-hover:text-fg1 pt-1">
                  Conectar Fathom →
                </p>
              </div>
            </div>
          </Link>

          <div className="grid md:grid-cols-3 gap-4">
            <Link
              href="/setup"
              className="group rounded-2xl border border-separator1 bg-bg1 p-6 space-y-3 hover:border-intense hover:bg-bg2 transition-colors"
            >
              <PhoneCall className="h-6 w-6 text-fg2" />
              <h2 className="text-xl font-light">Practicar con un prospecto</h2>
              <p className="text-sm text-fg3">
                Sube tu oferta y tus llamadas. El bot emula a tus leads reales,
                no a un prospecto genérico.
              </p>
              <p className="text-xs text-fg2 group-hover:text-fg1">
                Configurar y practicar →
              </p>
            </Link>

            <Link
              href="/reporte"
              className="group rounded-2xl border border-separator1 bg-bg1 p-6 space-y-3 hover:border-intense hover:bg-bg2 transition-colors"
            >
              <FileSearch className="h-6 w-6 text-fg2" />
              <h2 className="text-xl font-light">Analizar una llamada real</h2>
              <p className="text-sm text-fg3">
                Pega la transcripción de una llamada. Te armamos el QC: ficha,
                descubrimiento, pitch, objeciones, palancas y seguimiento.
              </p>
              <p className="text-xs text-fg2 group-hover:text-fg1">
                Subir transcripción →
              </p>
            </Link>

            <Link
              href="/coach"
              className="group rounded-2xl border border-separator1 bg-bg1 p-6 space-y-3 hover:border-intense hover:bg-bg2 transition-colors"
            >
              <GraduationCap className="h-6 w-6 text-fg2" />
              <h2 className="text-xl font-light">Coach high-ticket</h2>
              <p className="text-sm text-fg3">
                Un entrenador que lee tus prácticas y tus QC, te dice en qué
                estás trabado y qué drill sigue. Requiere cuenta.
              </p>
              <p className="text-xs text-fg2 group-hover:text-fg1">
                Abrir coaching →
              </p>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
