"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { AuthMenu } from "@/components/auth-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QcReportView } from "@/components/qc-report-view";
import type { QcCallReport } from "@/data/qc-report";
import { FREE_QC_USED_CODE } from "@/lib/guest-practice-client";

const ANALYZE_STEPS = [
  "Leyendo la transcripción…",
  "Armando la ficha del prospecto…",
  "Revisando descubrimiento, pitch y objeciones…",
  "Escribiendo palancas y notas…",
];

const REGISTER_QC_URL =
  "/login?mode=register&reason=qc-used&callbackUrl=/reporte";

export default function ReportePage() {
  const { status } = useSession();
  const router = useRouter();
  const [transcript, setTranscript] = useState("");
  const [closerName, setCloserName] = useState("");
  const [productName, setProductName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<QcCallReport | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!busy) {
      setStepIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setStepIndex((current) => (current + 1) % ANALYZE_STEPS.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [busy]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/qc-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          closerName: closerName.trim() || undefined,
          productName: productName.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === FREE_QC_USED_CODE) {
          router.push(REGISTER_QC_URL);
          return;
        }
        throw new Error(data.error || "No se pudo generar el reporte");
      }
      setReport(data as QcCallReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
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
        {!report && busy && (
          <div className="rounded-2xl border border-separator1 bg-bg1 px-6 py-16 text-center space-y-4">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <div className="space-y-2">
              <h1 className="text-2xl font-light">Auditando la llamada</h1>
              <p className="text-sm text-fg2">{ANALYZE_STEPS[stepIndex]}</p>
              <p className="text-xs text-fg3 max-w-sm mx-auto">
                Esto puede tardar hasta un minuto si la transcripción es larga.
                No cierres esta pestaña.
              </p>
            </div>
          </div>
        )}

        {!report && !busy && (
          <>
            <div>
              <h1 className="text-2xl font-light">Reporte de llamada real</h1>
              <p className="text-sm text-fg3 mt-2">
                Pega la transcripción (Fathom u otro). Armamos el QC: ficha,
                descubrimiento, pitch, objeciones, fallas que alimentaron el
                no, palancas y notas del prospecto.
              </p>
              {status === "unauthenticated" && (
                <p className="text-xs text-fg3 mt-2">
                  Sin cuenta puedes auditar 1 llamada completa. La siguiente pide
                  registro. La práctica con prospecto es aparte.
                </p>
              )}
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="closer">Nombre del closer</Label>
                  <Input
                    id="closer"
                    value={closerName}
                    onChange={(e) => setCloserName(e.target.value)}
                    placeholder="Ej: Amaranta"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="product">Oferta (si la sabes)</Label>
                  <Input
                    id="product"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="Ej: Fertilidad Consciente"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="transcript">Transcripción</Label>
                <Textarea
                  id="transcript"
                  required
                  rows={16}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Pega aquí el texto de Fathom: timestamps, nombres y lo que dijeron…"
                  className="min-h-64 font-mono text-xs"
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button type="submit" variant="primary">
                Generar reporte
              </Button>
            </form>
          </>
        )}

        {report && (
          <>
            <QcReportView
              report={report}
              authenticated={status === "authenticated"}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setReport(null);
                  setError(null);
                }}
              >
                Auditar otra
              </Button>
              <Button asChild variant="primary">
                <Link href="/practicar">Practicar con un prospecto</Link>
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
