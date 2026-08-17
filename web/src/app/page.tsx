import { Metadata } from "next";
import Link from "next/link";
import { PhoneCall, FileSearch } from "lucide-react";
import { AuthMenu } from "@/components/auth-menu";

export const metadata: Metadata = {
  title: "Closer Trainer | Coaching de cierre",
  description:
    "Practica con un prospecto o analiza una llamada real y recibe el reporte de QC.",
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-bg0 flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 md:px-8 py-4 border-b border-separator1">
        <span className="text-lg font-light">Closer Trainer</span>
        <AuthMenu />
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-light">¿Qué quieres hacer?</h1>
            <p className="text-sm text-fg3 max-w-lg mx-auto">
              Elige una. Puedes cambiar después desde Inicio.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Link
              href="/practicar"
              className="group rounded-2xl border border-separator1 bg-bg1 p-6 space-y-3 hover:border-intense hover:bg-bg2 transition-colors"
            >
              <PhoneCall className="h-6 w-6 text-fg2" />
              <h2 className="text-xl font-light">Practicar con un prospecto</h2>
              <p className="text-sm text-fg3">
                Roleplay en vivo. El lead agendó la reunión, tiene contexto del
                producto y objeta según la dificultad.
              </p>
              <p className="text-xs text-fg2 group-hover:text-fg1">
                Empezar práctica →
              </p>
            </Link>

            <Link
              href="/reporte"
              className="group rounded-2xl border border-separator1 bg-bg1 p-6 space-y-3 hover:border-intense hover:bg-bg2 transition-colors"
            >
              <FileSearch className="h-6 w-6 text-fg2" />
              <h2 className="text-xl font-light">Analizar una llamada real</h2>
              <p className="text-sm text-fg3">
                Pega la transcripción (Fathom u otra). Te armamos el QC: ficha,
                descubrimiento, pitch, objeciones, palancas y seguimiento.
              </p>
              <p className="text-xs text-fg2 group-hover:text-fg1">
                Subir transcripción →
              </p>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
