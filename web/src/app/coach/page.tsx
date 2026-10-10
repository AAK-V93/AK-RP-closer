"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { CALL_SECTION_LABELS, CallSection } from "@/data/training-session";
import type { CoachingInsights } from "@/lib/coaching";
import { shownPracticeOutcome, type CoachBoard } from "@/lib/coach-offers";
import { formatBogotaDay } from "@/lib/crm-time";
import type { LiveGuide } from "@/lib/live-guide";
import { CloserCoachChat } from "@/components/closer-coach-chat";
import { CoachMarkdown } from "@/components/coach-markdown";
import { ChevronRight } from "lucide-react";
import { DeleteAnalysisButton } from "@/components/delete-analysis-button";
import { closerSpanish } from "@/lib/closer-spanish";

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function peopleLabel(count: number) {
  return count === 1 ? "1 persona" : `${count} personas`;
}


export default function CoachPage() {
  const { status } = useSession();
  const [insights, setInsights] = useState<
    (CoachingInsights & {
      liveGuides?: LiveGuide[];
      coachBoard?: CoachBoard;
    }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [noteFocus, setNoteFocus] = useState("");

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

  const board = insights?.coachBoard;
  const guides = asList<LiveGuide>(insights?.liveGuides);
  const objection = board?.objection?.text ? closerSpanish(board.objection.text) : "";
  const drill = closerSpanish(
    guides.flatMap((guide) => asList<string>(guide.drills))[0] ||
      asList<CoachingInsights["suggestions"][number]>(insights?.suggestions)[0]?.text ||
      "",
  );
  const rawFocus = objection || noteFocus || drill;
  const focus = rawFocus.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
  const hasNumbers = Boolean(board?.monthVersus || board?.monthCalls || (board?.offers.length || 0) > 0);

  return (
    <AppShell>
      <div className="min-w-0 max-w-full space-y-8 overflow-x-clip">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-fg0">Tu coaching</h1>
          <p className="mt-1 max-w-xl text-sm text-fg3">
            Después de una llamada: qué te frenó este mes y un ejercicio para la próxima.
          </p>
        </div>

        {status === "unauthenticated" && (
          <div className="space-y-3 rounded-2xl border border-separator1 bg-bg1 p-6">
            <p className="text-sm">Entra con Google para que el coach recuerde tus llamadas y tus prácticas.</p>
            <Button asChild variant="primary">
              <Link href="/login?callbackUrl=/coach">Entrar o crear cuenta</Link>
            </Button>
          </div>
        )}

        {status === "authenticated" && error && <p className="text-sm text-destructive">{error}</p>}
        {status === "authenticated" && !insights && !error && (
          <p className="text-sm text-fg3">Cargando tu historial…</p>
        )}

        {hasNumbers && board && (
          <section className="rounded-2xl border border-separator1 bg-bg1 p-4 sm:p-5" aria-label="Este mes">
            <p className="text-[13px] text-fg3">Este mes, todas las ofertas</p>
            {board.monthVersus && (
              <p className="mt-1 text-[17px] leading-snug text-fg0 md:text-2xl">{board.monthVersus}</p>
            )}
            {board.monthCalls && <p className="mt-1 text-sm text-fg2">{board.monthCalls}</p>}
          </section>
        )}

        {status === "authenticated" && (objection || focus) && (
          <section className="space-y-3 rounded-2xl border border-[#EBD3A8] bg-[#F6E7CC] px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7A4C0E]">
              {objection ? "Lo que más frena los cierres" : "Siguiente ejercicio"}
            </p>
            {objection && board?.objection ? (
              <p className="text-[15px] leading-snug text-fg0">
                {board.objection.periodLabel}
                {board.objection.offerName ? ` · ${board.objection.offerName}` : ""}
                {" · "}
                <span className="font-medium">«{objection}»</span>
                {" · "}
                {peopleLabel(board.objection.people)}
              </p>
            ) : (
              <CoachMarkdown text={rawFocus} className="text-[15px] leading-snug text-fg0" />
            )}
            <Button asChild size="sm" variant="primary" className="min-h-11">
              <Link href={`/practicar?focus=${encodeURIComponent(focus)}`}>Practicar esto</Link>
            </Button>
          </section>
        )}

        {hasNumbers && board && board.offers.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {board.offers.map((offer) => (
              <li key={offer.offerName} className="rounded-2xl border border-separator1 bg-bg1 px-3 py-3">
                <p className="text-sm font-medium text-fg0">{offer.offerName}</p>
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-fg3">Este mes</p>
                <p className="mt-0.5 text-sm text-fg0">
                  {[offer.monthVersus, offer.monthCalls].filter(Boolean).join(" · ") || "Sin llamadas este mes"}
                </p>
                {(offer.historyVersus || offer.historyCalls) && (
                  <>
                    <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-fg3">Histórico</p>
                    <p className="mt-0.5 text-sm text-fg2">
                      {[offer.historyVersus, offer.historyCalls].filter(Boolean).join(" · ")}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {status === "authenticated" && (
          <CloserCoachChat
            onNotes={(notes) => {
              const next = closerSpanish(notes.nextSkill || notes.recommendedExercise || "");
              if (next) setNoteFocus(next);
            }}
          />
        )}

        {insights && insights.practiceCount === 0 && asList(insights.recent).length === 0 && !hasNumbers && !focus && (
          <div className="space-y-3 rounded-2xl border border-separator1 bg-bg1 p-6">
            <p className="text-sm">
              El coach ya puede hablar contigo. Para que vea evidencia, haz una práctica por voz o revisa una llamada.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="primary">
                <Link href="/practicar">Ir a practicar</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/llamadas">Revisar una llamada</Link>
              </Button>
            </div>
          </div>
        )}

        {insights && asList(insights.recent).length > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-medium text-fg0">Últimas prácticas</h2>
            <div className="space-y-2">
              {asList<CoachingInsights["recent"][number]>(insights.recent).map((item) => (
                <div
                  key={item.id}
                  className="flex justify-between gap-3 rounded-xl border border-separator1 bg-bg1 p-4 text-sm"
                >
                  <Link href={`/coach/${item.id}`} className="min-w-0 flex-1">
                    <p className="font-medium">{closerSpanish(item.productName || "")}</p>
                    <p className="text-xs text-fg3">
                      {[
                        item.callSection === "qc_transcript"
                          ? "Reporte de llamada real"
                          : closerSpanish(CALL_SECTION_LABELS[item.callSection as CallSection] ?? item.callSection),
                        formatBogotaDay(item.createdAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {shownPracticeOutcome(closerSpanish(item.outcomeSummary || "")) && (
                      <CoachMarkdown
                        text={shownPracticeOutcome(closerSpanish(item.outcomeSummary || ""))}
                        className="mt-1 text-xs text-fg2"
                      />
                    )}
                  </Link>
                  {/* «Ver» on top, the trash far below it: hard to hit by accident (and it asks first). */}
                  <div className="flex shrink-0 flex-col items-end justify-between gap-6">
                    <Link href={`/coach/${item.id}`} className="inline-flex min-h-11 items-center text-xs text-fg3">
                      Ver
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                    <DeleteAnalysisButton sessionId={item.id} iconOnly variant="ghost" onDeleted={loadInsights} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
