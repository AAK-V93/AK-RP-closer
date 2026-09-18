"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { FathomSyncPanel } from "@/components/fathom-sync-panel";
import { CalendarConnectPanel } from "@/components/calendar-connect-panel";
import { Button } from "@/components/ui/button";

type CallRow = {
  id: string;
  source: string;
  title: string;
  date: string | null;
  callType: string;
  result: string;
  leadName: string;
  offerName: string;
  trainsBot: boolean;
  analyzed: boolean;
  href: string;
};

export default function LlamadasPage() {
  const { status } = useSession();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [auditingId, setAuditingId] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  const loadCalls = () =>
    fetch("/api/llamadas")
      .then((r) => r.json())
      .then((data) => setCalls(data.calls || []))
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

  return (
    <AppShell wide>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-light">Mis llamadas</h1>
          <p className="text-sm text-fg3">
            Una sola biblioteca. Fathom o archivos. De aquí salen la práctica
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
              <Link href="/ofertas">Subir archivos o pegar transcript</Link>
            </Button>
            {auditError && (
              <p className="text-sm text-destructive">{auditError}</p>
            )}
            <div className="space-y-2">
              {calls.map((row) => (
                <div
                  key={`${row.source}-${row.id}`}
                  className="rounded-xl border border-separator1 bg-bg1 px-3 py-2 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm truncate">{row.title}</p>
                    <p className="text-xs text-fg3">
                      {[row.leadName, row.offerName, row.callType, row.result]
                        .filter(Boolean)
                        .join(" · ") || row.source}
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
                          row.result === "cerro" ||
                          row.callType === "interna" ||
                          row.callType === "no_comercial"
                            ? `/practicar?mode=compose&focus=${encodeURIComponent(row.leadName || row.title)}`
                            : `/practicar?mode=replay&call=${encodeURIComponent(`${row.source}:${row.id}`)}`
                        }
                      >
                        {row.result === "cerro" ||
                        row.callType === "interna" ||
                        row.callType === "no_comercial"
                          ? "Lead nuevo"
                          : "Recrear"}
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
              {calls.length === 0 && (
                <p className="text-sm text-fg3">Aún no hay llamadas. Conecta Fathom o súbelas.</p>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
