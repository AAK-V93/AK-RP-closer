import Link from "next/link";
import { getServerSession } from "next-auth";
import { Button } from "@/components/ui/button";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

// v2, PR 1: only the clean database. The screens arrive in the next PRs
// (Mis ofertas, Metas, Hoy, Personas, Practicar). This page does not read
// the database: the session lives in the cookie.
export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const signedIn = Boolean(session?.user?.id);
  return (
    <div className="min-h-screen bg-bg0 flex flex-col">
      <header className="flex items-center px-6 py-4 border-b border-separator1">
        <span className="text-lg font-light">Closer Trainer</span>
      </header>
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-separator1 bg-bg1 p-6">
          {signedIn ? (
            <>
              <h1 className="font-display text-2xl text-fg0">Tu cuenta nueva está lista</h1>
              <p className="text-sm text-fg3">
                Estamos armando la versión nueva. Aquí vas a ver a quién escribirle hoy y
                cómo vas con tu meta.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl text-fg0">Entrena con tus llamadas reales</h1>
              <p className="text-sm text-fg3">
                Practica tus cierres, sigue a cada persona y llega a tu meta del mes.
              </p>
              <Button asChild variant="primary">
                <Link href="/login?callbackUrl=/">Entrar</Link>
              </Button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
