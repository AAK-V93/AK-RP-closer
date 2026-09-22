"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CALL_SECTION_LABELS, CallSection } from "@/data/training-session";
import type { CoachingInsights } from "@/lib/coaching";
import type { LiveGuide } from "@/lib/live-guide";
import { CloserCoachChat } from "@/components/closer-coach-chat";
import { ChevronRight } from "lucide-react";
import { DeleteAnalysisButton } from "@/components/delete-analysis-button";

export default function CoachPage() {
  const { status } = useSession();
  const [insights, setInsights] = useState<
    (CoachingInsights & {
      liveGuides?: LiveGuide[];
      extractorGaps?: { thisWeek: number; lastWeek: number };
    }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const loadInsights = () => {
    fetch("/api/coach")
      .then(async (r) => {
        const text = await r.text();
        if (!text) throw new Error("No se pudo cargar");
        const data = JSON.parse(text);
        if (!r.ok) throw new Error(data.error || "No se pudo cargar");
        setInsights(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  };

  useEffect(() => {
    if (status !== "authenticated") return;
    loadInsights();
  }, [status]);

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-light">Tu coaching</h1>
          <p className="text-sm text-fg3 mt-1">
            Un closer high-ticket que lee tus prácticas por voz y tus QC de
            llamadas reales. Te dice el nivel, la debilidad y el siguiente
            drill — no un score suelto.
          </p>
          {insights?.extractorGaps && (
            <p className="text-xs text-fg3 mt-2">
              Huecos esta semana: {insights.extractorGaps.thisWeek} (semana
              pasada: {insights.extractorGaps.lastWeek})
            </p>
          )}
        </div>

        {status === "unauthenticated" && (
          <div className="rounded-2xl border border-separator1 bg-bg1 p-6 space-y-3">
            <p className="text-sm">
              Entra con Google para que el coach recuerde tu avance y cruce
              cada práctica y cada llamada real.
            </p>
            <Button asChild variant="primary">
              <Link href="/login?callbackUrl=/coach">Entrar o crear cuenta</Link>
            </Button>
          </div>
        )}

        {status === "authenticated" && (
          <CloserCoachChat />
        )}

        {insights?.liveGuides && insights.liveGuides.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-light">Guía viva por oferta</h2>
            {insights.liveGuides.map((guide) => (
              <div
                key={guide.offerName}
                className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{guide.offerName || "Oferta"}</p>
                  <p className="text-xs text-fg3">
                    {guide.callCount} llamada{guide.callCount === 1 ? "" : "s"}
                  </p>
                </div>
                <p className="text-sm text-fg2">{guide.note}</p>
                {guide.ready && (
                  <>
                    {guide.closingTypes.length > 0 && (
                      <div>
                        <p className="text-[11px] uppercase tracking-widest text-fg3">
                          Quién cierra
                        </p>
                        <ul className="mt-1 space-y-1 text-sm">
                          {guide.closingTypes.map((row) => (
                            <li key={row.type}>
                              {row.type}
                              {row.approach ? ` · ${row.approach}` : ""}{" "}
                              <span className="text-fg3">
                                {row.closed}/{row.total}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {guide.scriptVariations.length > 0 && (
                      <div>
                        <p className="text-[11px] uppercase tracking-widest text-fg3">
                          Variación del script
                        </p>
                        <ul className="mt-1 space-y-1 text-sm">
                          {guide.scriptVariations.map((row) => (
                            <li key={`${row.leadType}-${row.variation}`}>
                              {row.leadType}: {row.variation}{" "}
                              <span className="text-fg3">
                                {row.closed}/{row.total}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {guide.winMoments.length > 0 && (
                      <p className="text-sm">
                        En las que cerraron: {guide.winMoments.join(" · ")}
                      </p>
                    )}
                    {guide.missingInLosses.length > 0 && (
                      <p className="text-sm">
                        No aparece en las perdidas: {guide.missingInLosses.join(" · ")}
                      </p>
                    )}
                    {guide.drills.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {guide.drills.map((drill) => (
                          <Button key={drill} asChild size="sm" variant="primary">
                            <Link href={`/practicar?focus=${encodeURIComponent(drill)}`}>
                              {drill}
                            </Link>
                          </Button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </section>
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
              El coach ya puede hablar contigo. Para que vea evidencia real,
              haz una práctica por voz o sube el QC de una llamada.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="primary">
                <Link href="/practicar">Ir a practicar</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/llamadas">Auditar una llamada</Link>
              </Button>
            </div>
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
                      className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm space-y-2"
                    >
                      <p>
                        {s.count > 1 && (
                          <span className="text-xs text-fg3 mr-2">
                            salió {s.count} veces
                          </span>
                        )}
                        {s.text}
                      </p>
                      <Button asChild size="sm" variant="primary">
                        <Link href={`/practicar?focus=${encodeURIComponent(s.text)}`}>
                          Practicar esto
                        </Link>
                      </Button>
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
                    className="rounded-xl border border-separator1 bg-bg1 p-4 text-sm flex justify-between gap-3 hover:border-primary/40"
                  >
                    <Link href={`/coach/${r.id}`} className="min-w-0 flex-1">
                      <p className="font-medium">{r.productName}</p>
                      <p className="text-xs text-fg3">
                        {r.callSection === "qc_transcript"
                          ? "Reporte de llamada real"
                          : CALL_SECTION_LABELS[r.callSection as CallSection] ??
                            r.callSection}{" "}
                        · {new Date(r.createdAt).toLocaleString()}
                      </p>
                      {r.outcomeSummary && (
                        <p className="text-xs text-fg2 mt-1">{r.outcomeSummary}</p>
                      )}
                    </Link>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-lg font-light">
                        {r.scored ? Math.round(r.overallScore) : "—"}
                      </span>
                      {!r.scored ? (
                        <span className="text-xs text-fg3">Evaluar</span>
                      ) : (
                        <Link
                          href={`/coach/${r.id}`}
                          className="text-xs text-fg3 inline-flex items-center"
                        >
                          Ver análisis
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      <DeleteAnalysisButton
                        sessionId={r.id}
                        iconOnly
                        variant="ghost"
                        onDeleted={loadInsights}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <Button asChild variant="primary">
              <Link href="/practicar">Nueva práctica</Link>
            </Button>
          </>
        )}
      </div>
    </AppShell>
  );
}
