"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { FathomSyncPanel } from "@/components/fathom-sync-panel";
import { CalendarConnectPanel } from "@/components/calendar-connect-panel";
import { Button } from "@/components/ui/button";
import { isNonSalesCall } from "@/lib/call-kind";
import { quickFollowupIso } from "@/lib/followup-date";
import { joinDistinct } from "@/lib/crm-noise";
import { countPhrase, plainStatus } from "@/lib/plain-labels";

type CallRow = {
  id: string;
  source: string;
  title: string;
  interna?: boolean;
  date: string | null;
  callType: string;
  result: string;
  leadName: string;
  offerName: string;
  trainsBot: boolean;
  analyzed: boolean;
  href: string;
};

type Review = {
  id: string;
  title: string;
  question: string;
  field: string;
  showToggle: boolean;
  options?: string[];
};

export default function LlamadasPage() {
  const { status } = useSession();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [unclassified, setUnclassified] = useState(0);
  const [otherDate, setOtherDate] = useState("");
  const [answer, setAnswer] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [auditingId, setAuditingId] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [showInternas, setShowInternas] = useState(false);

  const loadCalls = () =>
    fetch("/api/llamadas")
      .then((r) => r.json())
      .then((data) => {
        setCalls(Array.isArray(data?.calls) ? data.calls : []);
        setReview(data?.review && typeof data.review === "object" ? data.review : null);
        setUnclassified(Number(data?.unclassified) || 0);
      })
      .catch(() => undefined);

  useEffect(() => {
    if (status !== "authenticated") return;
    void loadCalls();
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (calls.length === 0) return;
    if (calls.every((row) => row.callType)) return;
    let cancelled = false;
    const classifyNext = async () => {
      const response = await fetch("/api/llamadas", { method: "POST" });
      const data = await response.json();
      if (cancelled || data.done) return;
      await loadCalls();
    };
    void classifyNext().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status, calls]);

  const sendReview = async (body: Record<string, string>) => {
    if (!review) return;
    setReviewing(true);
    setAuditError(null);
    try {
      const response = await fetch("/api/llamadas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callRecordId: review.id, ...body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar");
      setReview(data.review || null);
      setUnclassified(Number(data.unclassified) || 0);
      setAnswer("");
      setOtherDate("");
      await loadCalls();
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setReviewing(false);
    }
  };

  return (
    <AppShell wide>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-light">Mis llamadas</h1>
          <p className="text-sm text-fg3">
            Una sola biblioteca. Grabaciones o archivos. De aquí salen la práctica
            por voz, el coach y el CRM.
          </p>
        </div>

        {status !== "authenticated" ? (
          <Button asChild variant="primary">
            <Link href="/login?callbackUrl=/llamadas">Entrar</Link>
          </Button>
        ) : (
          <>
            <FathomSyncPanel authenticated />
            <CalendarConnectPanel authenticated />
            <Button asChild variant="outline" size="sm">
              <Link href="/ofertas">Subir archivos o pegar una transcripción</Link>
            </Button>
            {review && unclassified > 0 && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                <p className="text-[11px] uppercase tracking-wide text-fg3">
                  {countPhrase(unclassified, "llamada por clasificar", "llamadas por clasificar")}
                </p>
                <p className="text-sm font-medium">{review.title}</p>
                {review.showToggle ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="min-h-11"
                      variant="primary"
                      disabled={reviewing}
                      onClick={() => void sendReview({ action: "commercial" })}
                    >
                      Es comercial
                    </Button>
                    <Button
                      size="sm"
                      className="min-h-11"
                      variant="outline"
                      disabled={reviewing}
                      onClick={() => void sendReview({ action: "non_commercial" })}
                    >
                      No es comercial
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm">{review.question}</p>
                    {Array.isArray(review.options) && review.options.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {review.options.map((option) => (
                          <Button
                            key={option}
                            size="sm"
                            className="min-h-11"
                            variant="outline"
                            disabled={reviewing}
                            onClick={() =>
                              void sendReview({
                                action: "answer",
                                field: review.field || "producto",
                                value: option,
                              })
                            }
                          >
                            {option}
                          </Button>
                        ))}
                      </div>
                    ) : review.field === "proximo_seguimiento" ? (
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            ["hoy", "Hoy"],
                            ["manana", "Mañana"],
                            ["semana", "Esta semana"],
                          ] as const
                        ).map(([choice, label]) => (
                          <Button
                            key={choice}
                            size="sm"
                            className="min-h-11"
                            variant="outline"
                            disabled={reviewing}
                            onClick={() =>
                              void sendReview({
                                action: "answer",
                                field: "proximo_seguimiento",
                                value: quickFollowupIso(choice),
                              })
                            }
                          >
                            {label}
                          </Button>
                        ))}
                        <input
                          type="date"
                          value={otherDate}
                          onChange={(event) => setOtherDate(event.target.value)}
                          className="h-11 min-h-[44px] rounded-md border border-separator1 bg-bg0 px-2 text-xs md:h-8 md:min-h-0"
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={reviewing || !otherDate}
                          onClick={() =>
                            void sendReview({
                              action: "answer",
                              field: "proximo_seguimiento",
                              value: otherDate,
                            })
                          }
                        >
                          Otra fecha
                        </Button>
                      </div>
                    ) : (
                      <form
                        className="flex gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!answer.trim()) return;
                          void sendReview({
                            action: "answer",
                            field: review.field || "revision",
                            value: answer.trim(),
                          });
                        }}
                      >
                        <input
                          value={answer}
                          onChange={(event) => setAnswer(event.target.value)}
                          className="flex-1 h-11 min-h-[44px] rounded-md border border-separator1 bg-bg0 px-2 text-sm md:h-8 md:min-h-0"
                          placeholder="La respuesta"
                        />
                        <Button size="sm" variant="primary" disabled={reviewing || !answer.trim()}>
                          Guardar
                        </Button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            )}
            {auditError && (
              <p className="text-sm text-destructive">{auditError}</p>
            )}
            <div className="space-y-2">
              {calls.some((row) => row.interna) && (
                <Button
                  size="sm"
                  className="min-h-11"
                  variant={showInternas ? "primary" : "outline"}
                  onClick={() => setShowInternas((value) => !value)}
                >
                  {showInternas
                    ? "Ocultar llamadas internas"
                    : `Mostrar llamadas internas (${calls.filter((row) => row.interna).length})`}
                </Button>
              )}
              {(showInternas ? calls : calls.filter((row) => !row.interna)).map((row) => (
                <div
                  key={`${row.source}-${row.id}`}
                  className="rounded-xl border border-separator1 bg-bg1 px-3 py-2 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm truncate">{row.title}</p>
                    <p className="text-xs text-fg3">
                      {joinDistinct([
                        row.leadName,
                        row.offerName,
                        row.callType ? plainStatus(row.callType) : "",
                        row.result ? plainStatus(row.result) : "",
                      ]) || row.source}
                      {row.trainsBot ? " · entra a la práctica" : ""}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {row.analyzed ? (
                      <Button asChild size="sm" variant="ghost">
                        <Link href={row.href}>Coach</Link>
                      </Button>
                    ) : row.source === "upload" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={auditingId === row.id}
                        onClick={async () => {
                          setAuditingId(row.id);
                          setAuditError(null);
                          try {
                            const response = await fetch("/api/qc-report", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ uploadId: row.id }),
                            });
                            const data = await response.json();
                            if (!response.ok) {
                              throw new Error(data.error || "No se pudo auditar");
                            }
                            await loadCalls();
                            if (data.sessionId) {
                              window.location.href = `/coach/${data.sessionId}`;
                            }
                          } catch (error) {
                            setAuditError(
                              error instanceof Error
                                ? error.message
                                : "No se pudo auditar",
                            );
                          } finally {
                            setAuditingId(null);
                          }
                        }}
                      >
                        {auditingId === row.id ? "Auditando…" : "Auditar"}
                      </Button>
                    ) : null}
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={
                          row.result === "cerro" || isNonSalesCall(row.callType)
                            ? `/practicar?mode=compose&focus=${encodeURIComponent(row.leadName || row.title)}`
                            : `/practicar?mode=replay&call=${encodeURIComponent(`${row.source}:${row.id}`)}`
                        }
                      >
                        {row.result === "cerro" || isNonSalesCall(row.callType)
                          ? "Prospecto nuevo"
                          : "Recrear"}
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
              {calls.length === 0 && (
                <p className="text-sm text-fg3">Aún no hay llamadas. Conecta las grabaciones o súbelas.</p>
              )}
              {calls.length > 0 && !showInternas && calls.every((row) => row.interna) && (
                <p className="text-sm text-fg3">
                  Solo hay llamadas internas. Ábrelas con el botón de arriba.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
