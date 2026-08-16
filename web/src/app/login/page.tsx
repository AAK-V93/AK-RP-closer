"use client";

import { FormEvent, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [hasGoogleAuth, setHasGoogleAuth] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.hasGoogleAuth === "boolean") {
          setHasGoogleAuth(data.hasGoogleAuth);
        }
      })
      .catch(() => undefined);
  }, []);

  const onGoogle = async () => {
    setError(null);
    setGoogleBusy(true);
    try {
      await signIn("google", { callbackUrl: "/coach" });
    } catch {
      setError("No se pudo abrir Google");
      setGoogleBusy(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo registrar");
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        throw new Error(
          mode === "register"
            ? "Cuenta creada, pero no se pudo entrar. Revisa la contraseña."
            : "Email o contraseña incorrectos. Si te registraste con Google, usa ese botón.",
        );
      }
      router.push("/coach");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg0 flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-separator1">
        <Link href="/" className="text-lg font-light">
          Closer Trainer
        </Link>
        <Link href="/" className="text-xs text-fg3">
          Volver a practicar
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-separator1 bg-bg1 p-6">
          <div>
            <h1 className="text-xl font-light">
              {mode === "login" ? "Entrar" : "Crear cuenta"}
            </h1>
            <p className="text-xs text-fg3 mt-1">
              Google confirma que el email es tuyo. Guardamos las prácticas para
              el coaching.
            </p>
          </div>

          {hasGoogleAuth && (
            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={googleBusy || busy}
              onClick={onGoogle}
            >
              {googleBusy ? "Abriendo Google…" : "Continuar con Google"}
            </Button>
          )}

          {hasGoogleAuth && (
            <p className="text-[11px] text-fg3 text-center">o con email</p>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "register" && (
              <div className="space-y-1">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button type="submit" variant="outline" className="w-full" disabled={busy || googleBusy}>
              {busy
                ? "Un momento…"
                : mode === "login"
                  ? "Entrar con email"
                  : "Crear cuenta con email"}
            </Button>
          </form>

          <button
            type="button"
            className="text-xs text-fg3 w-full"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login"
              ? "¿No tienes cuenta? Crear una con email"
              : "¿Ya tienes cuenta? Entrar"}
          </button>
        </div>
      </main>
    </div>
  );
}
