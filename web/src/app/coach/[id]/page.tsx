"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronLeft } from "lucide-react";
import { AuthMenu } from "@/components/auth-menu";
import { Button } from "@/components/ui/button";
import { CallScorePanel } from "@/components/call-score-panel";
import { QcReportView } from "@/components/qc-report-view";
import type { CallEvaluation } from "@/data/evaluation";
import type { QcCallReport } from "@/data/qc-report";
import {
  CALL_SECTION_LABELS,
  CallSection,
} from "@/data/training-session";

type TranscriptLine = { role?: string; text?: string };

type PracticeDetail = {
  id: string;
  createdAt: string;
  productName: string;
  callSection: string;
  difficulty: string;
  language: string;
  overallScore: number;
  outcomeSummary: string;
  scored: boolean;
  transcript: TranscriptLine[];
  evaluation: unknown;
};

function isQcReport(value: unknown): value is QcCallReport {
  if (!value || typeof value !== "object") return false;
  return "headline" in value && "discovery" in value && "prospectNotes" in value;
}

export default function CoachDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useSession();
  const [detail, setDetail] = useState<PracticeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const load = () => {
    if (!id) return;
    fetch(`/api/coach/${id}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "No se pudo cargar");
        setDetail(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?callbackUrl=/coach/${id}`);
      return;
    }
    if (status !== "authenticated") return;
    load();
  }, [status, id, router]);

  const retryEvaluation = async () => {
    if (!id) return;
    setRetrying(true);
    setError(null);
    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo reevaluar");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reevaluar");
    } finally {
      setRetrying(false);
    }
  };

  const qc =
    detail && isQcReport(detail.evaluation) ? detail.evaluation : null;
  const practiceEval =
    detail && detail.scored && !qc
      ? (detail.evaluation as CallEvaluation)
      : null;
  const lines = Array.isArray(detail?.transcript) ? detail.transcript : [];

  return (
    <div className="min-h-screen bg-bg0 flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 md:px-8 py-4 border-b border-separator1">
        <Link href="/" className="text-lg font-light">
          Closer Trainer
        </Link>
        <AuthMenu />
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 md:p-8 space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/coach">
            <ChevronLeft className="h-4 w-4" />
            Volver a tu coaching
          </Link>
        </Button>

        {status === "authenticated" && !detail && !error && (
          <p className="text-sm text-fg3">Cargando el análisis…</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {detail && (
          <>
            <div>
              <p className="text-xs text-fg3 uppercase tracking-wide">
                {detail.callSection === "qc_transcript"
                  ? "Reporte de llamada real"
                  : CALL_SECTION_LABELS[detail.callSection as CallSection] ??
                    detail.callSection}
              </p>
              <h1 className="text-2xl font-light mt-1">{detail.productName}</h1>
              <p className="text-xs text-fg3 mt-1">
                {new Date(detail.createdAt).toLocaleString()}
              </p>
            </div>

            {!detail.scored && (
              <div className="rounded-2xl border border-separator1 bg-bg1 p-4 space-y-3">
                <p className="text-sm">
                  Esta práctica se guardó, pero el análisis no alcanzó a
                  terminar. Puedes evaluarla ahora.
                </p>
                <Button
                  variant="primary"
                  disabled={retrying}
                  onClick={retryEvaluation}
                >
                  {retrying ? "Evaluando…" : "Evaluar ahora"}
                </Button>
              </div>
            )}

            {qc && (
              <QcReportView report={{ ...qc, saved: false }} authenticated />
            )}

            {practiceEval && (
              <CallScorePanel
                evaluation={{ ...practiceEval, saved: false }}
                isLoading={false}
              />
            )}

            {lines.length > 0 && (
              <section className="space-y-2">
                <button
                  type="button"
                  className="text-sm text-fg2 underline"
                  onClick={() => setShowTranscript((open) => !open)}
                >
                  {showTranscript ? "Ocultar transcripción" : "Ver transcripción"}
                </button>
                {showTranscript && (
                  <div className="rounded-xl border border-separator1 bg-bg1 p-4 space-y-2 max-h-[480px] overflow-y-auto">
                    {lines.map((line, i) => (
                      <p key={i} className="text-sm">
                        <span className="text-xs uppercase text-fg3 mr-2">
                          {line.role === "prospect" ? "Prospecto" : "Tú"}
                        </span>
                        {line.text}
                      </p>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
