"use client";

import { FormEvent, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";

function safeCallbackUrl(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/coach";
  return raw;
}

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
  const [callbackUrl, setCallbackUrl] = useState("/coach");
  const [fromCustomOffer, setFromCustomOffer] = useState(false);
  const [fromFreeUsed, setFromFreeUsed] = useState(false);
  const [fromQcUsed, setFromQcUsed] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.hasGoogleAuth === "boolean") {
          setHasGoogleAuth(data.hasGoogleAuth);
        }
      })
      .catch(() => undefined);

    const params = new URLSearchParams(window.location.search);
    setCallbackUrl(safeCallbackUrl(params.get("callbackUrl") || params.get("next")));
    if (params.get("mode") === "register") setMode("register");
    if (params.get("reason") === "custom-offer") setFromCustomOffer(true);
    if (params.get("reason") === "free-used") setFromFreeUsed(true);
    if (params.get("reason") === "qc-used") setFromQcUsed(true);
    const hadQueryError = Boolean(params.get("error") || params.get("e"));
    const hadCookie = document.cookie.includes("closer_auth_error=1");
    if (hadCookie || hadQueryError) {
      setError("No se pudo guardar tu cuenta. Intenta de nuevo.");
      document.cookie = "closer_auth_error=; Max-Age=0; path=/";
    }
    if (window.location.search) {
      window.history.replaceState({}, "", "/login");
    }
  }, []);

  const onGoogle = async () => {
    setError(null);
    setGoogleBusy(true);
    try {
      await signIn("google", { callbackUrl });
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
      router.push(callbackUrl);
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
              {fromQcUsed
                ? "Ya usaste tu reporte gratis. Crea una cuenta para auditar más llamadas reales."
                : fromFreeUsed
                ? "Ya usaste tu práctica gratis. Crea una cuenta para seguir practicando y guardar tus reportes."
                : fromCustomOffer
                ? "Para practicar tu propia oferta, crea una cuenta. Luego volvemos a la práctica."
                : "Google confirma que el email es tuyo. Guardamos las prácticas para el coaching."}
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
