"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AuthMenu } from "@/components/auth-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CALL_SECTION_LABELS, CallSection } from "@/data/training-session";
import type { CoachingInsights } from "@/lib/coaching";

export default function CoachPage() {
  const { status } = useSession();
  const [insights, setInsights] = useState<CoachingInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadInsights = () => {
    fetch("/api/coach")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "No se pudo cargar");
        setInsights(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  };

  useEffect(() => {
    if (status !== "authenticated") return;
    loadInsights();
  }, [status]);

  const retryEvaluation = async (id: string) => {
    setRetryingId(id);
    setError(null);
    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo reevaluar");
      loadInsights();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reevaluar");
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-bg0 flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 md:px-8 py-4 border-b border-separator1">
        <Link href="/" className="text-lg font-light">
          Closer Trainer
        </Link>
        <AuthMenu />
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 md:p-8 space-y-8">
        <div>
          <h1 className="text-2xl font-light">Tu coaching</h1>
          <p className="text-sm text-fg3 mt-1">
            Errores que más se te repiten y sugerencias concretas. Esto no es un
            score suelto: es el patrón de tus llamadas.
          </p>
        </div>

        {status === "unauthenticated" && (
          <div className="rounded-2xl border border-separator1 bg-bg1 p-6 space-y-3">
            <p className="text-sm">
              Entra con Google para guardar cada práctica y ver en qué te trabas
              (dolor, 3A, usar el descubrimiento…).
            </p>
            <Button asChild variant="primary">
              <Link href="/login">Entrar o crear cuenta</Link>
            </Button>
          </div>
        )}

        {status === "authenticated" && error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {status === "authenticated" && !insights && !error && (
          <p className="text-sm text-fg3">Cargando tu historial…</p>
        )}

        {insights && insights.practiceCount === 0 && insights.recent.length === 0 && (
          <div className="rounded-2xl border border-separator1 bg-bg1 p-6 space-y-3">
            <p className="text-sm">
              Aún no hay prácticas guardadas. Entra a una llamada con la sesión
              iniciada; al colgar se guarda el reporte.
            </p>
            <Button asChild variant="primary">
              <Link href="/">Ir a practicar</Link>
            </Button>
          </div>
        )}

        {insights && (insights.practiceCount > 0 || insights.recent.length > 0) && (
          <>
            <section className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-separator1 bg-bg1 p-4">
                <p className="text-xs text-fg3 uppercase tracking-wide">
                  Prácticas
                </p>
                <p className="text-3xl font-light mt-1">{insights.practiceCount}</p>
              </div>
              <div className="rounded-2xl border border-separator1 bg-bg1 p-4">
                <p className="text-xs text-fg3 uppercase tracking-wide">
                  Score medio
                </p>
                <p className="text-3xl font-light mt-1">
                  {Math.round(insights.avgScore)}
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-light">En qué más fallas</h2>
              {insights.weakSkills.length === 0 ? (
                <p className="text-sm text-fg3">
                  Todavía no hay un patrón débil claro. Sigue practicando.
                </p>
              ) : (
                <div className="space-y-2">
                  {insights.weakSkills.map((s) => (
                    <div
                      key={s.id}
                      className="rounded-xl border border-separator1 bg-bg1 p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">{s.label}</span>
                        <Badge variant="outline">
                          {s.avgScore.toFixed(1)}/10 · {s.timesLow} veces flojo
                        </Badge>
                      </div>
                      {s.lastFeedback && (
                        <p className="text-xs text-fg3 mt-2">{s.lastFeedback}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-light">Errores que más se repiten</h2>
              {insights.commonErrors.length === 0 ? (
                <p className="text-sm text-fg3">Aún no hay repeticiones claras.</p>
              ) : (
                <ol className="space-y-2">
                  {insights.commonErrors.map((e, i) => (
                    <li
                      key={i}
                      className="rounded-xl border border-separator1 bg-bg1 p-4 text-sm"
                    >
                      <span className="text-xs text-fg3 mr-2">{e.count}×</span>
                      {e.text}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-light">Qué practicar ahora</h2>
              {insights.suggestions.length === 0 ? (
                <p className="text-sm text-fg3">Sin sugerencias todavía.</p>
              ) : (
                <ul className="space-y-2">
                  {insights.suggestions.map((s, i) => (
                    <li
                      key={i}
                      className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm"
                    >
                      {s.count > 1 && (
                        <span className="text-xs text-fg3 mr-2">
                          salió {s.count} veces
                        </span>
                      )}
                      {s.text}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-light">Últimas prácticas</h2>
              <div className="space-y-2">
                {insights.recent.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl border border-separator1 bg-bg1 p-4 text-sm flex justify-between gap-3"
                  >
                    <div>
                      <p className="font-medium">{r.productName}</p>
                      <p className="text-xs text-fg3">
                        {CALL_SECTION_LABELS[r.callSection as CallSection] ??
                          r.callSection}{" "}
                        · {new Date(r.createdAt).toLocaleString()}
                      </p>
                      {r.outcomeSummary && (
                        <p className="text-xs text-fg2 mt-1">{r.outcomeSummary}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-lg font-light">
                        {r.scored ? Math.round(r.overallScore) : "—"}
                      </span>
                      {!r.scored && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retryingId === r.id}
                          onClick={() => retryEvaluation(r.id)}
                        >
                          {retryingId === r.id ? "Evaluando…" : "Evaluar ahora"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <Button asChild variant="primary">
              <Link href="/">Nueva práctica</Link>
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
