"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FathomStatus = {
  connected: boolean;
  lastSyncAt?: string | null;
  total?: number;
  withTranscript?: number;
  analyzed?: number;
};

type FathomRecordingRow = {
  id: string;
  title: string;
  shareUrl: string;
  recordedAt: string | null;
  hasTranscript: boolean;
  analyzed: boolean;
  practiceSessionId: string | null;
};

export function FathomSyncPanel({
  authenticated,
  onAnalyze,
  embedded = false,
}: {
  authenticated: boolean;
  onAnalyze?: (args: { transcript: string; title: string }) => void;
  embedded?: boolean;
}) {
  const [status, setStatus] = useState<FathomStatus | null>(null);
  const [recordings, setRecordings] = useState<FathomRecordingRow[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [coachReady, setCoachReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authenticated) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [connectionRes, recordingsRes] = await Promise.all([
        fetch("/api/fathom/connection"),
        fetch("/api/fathom/recordings"),
      ]);
      const connectionData = await connectionRes.json();
      const recordingsData = await recordingsRes.json();
      if (!connectionRes.ok) {
        throw new Error(connectionData.error || "No se pudo leer Fathom");
      }
      setStatus(connectionData);
      if (recordingsRes.ok) {
        setRecordings(recordingsData.recordings || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    load();
  }, [load]);

  const onConnect = async (event: FormEvent) => {
    event.preventDefault();
    setConnecting(true);
    setError(null);
    try {
      const response = await fetch("/api/fathom/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo conectar");
      setApiKey("");
      setStatus(data);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setConnecting(false);
    }
  };

  const onDisconnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const response = await fetch("/api/fathom/connection", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo desconectar");
      setStatus({ connected: false });
      setRecordings([]);
      setCoachReady(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setConnecting(false);
    }
  };

  const runFullPipeline = async () => {
    setSyncing(true);
    setCoachReady(false);
    setSyncMessage("Listando llamadas…");
    setError(null);
    try {
      let cursor: string | null = null;
      let meetingsDone = false;
      while (!meetingsDone) {
        const response = await fetch("/api/fathom/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "meetings", cursor }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo sincronizar");
        setSyncMessage("Importando llamadas de Fathom…");
        cursor = data.nextCursor || null;
        meetingsDone = Boolean(data.meetingsDone);
        if (!meetingsDone && !cursor) break;
      }

      let transcriptsDone = false;
      while (!transcriptsDone) {
        const response = await fetch("/api/fathom/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "transcripts" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo sincronizar");
        const remaining = data.remainingTranscripts ?? 0;
        setSyncMessage(
          remaining > 0
            ? `Descargando transcripciones… faltan ${remaining}`
            : "Transcripciones listas. Auditando llamadas…",
        );
        transcriptsDone = Boolean(data.done);
      }

      let analyzeDone = false;
      while (!analyzeDone) {
        const response = await fetch("/api/fathom/analyze", { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo auditar");
        const remaining = data.remaining ?? 0;
        setSyncMessage(
          remaining > 0
            ? `Auditando llamadas… faltan ${remaining}`
            : "Llamadas auditadas. El coach está diseñando tu estrategia…",
        );
        analyzeDone = Boolean(data.done);
        if (data.imported === 0 && data.done) break;
      }

      const coachRes = await fetch("/api/fathom/coach-strategy", {
        method: "POST",
      });
      const coachData = await coachRes.json();
      if (!coachRes.ok) {
        throw new Error(coachData.error || "No se pudo generar la estrategia");
      }

      setCoachReady(true);
      setSyncMessage(
        `Listo: ${coachData.analyzedCount} llamadas auditadas. Tu coach ya tiene la estrategia en Mi coaching.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setSyncMessage(null);
    } finally {
      setSyncing(false);
    }
  };

  const pickRecording = async (id: string, title: string) => {
    if (!onAnalyze) return;
    setError(null);
    try {
      const response = await fetch(`/api/fathom/recordings/${id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar");
      onAnalyze({ transcript: data.transcript, title: data.title || title });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  };

  if (!authenticated) {
    return (
      <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-2">
        <h2 className="text-lg font-light">Conectar Fathom</h2>
        <p className="text-sm text-fg3">
          Importa, audita y manda todo al coach automáticamente. Necesitas una
          cuenta.
        </p>
        <Button asChild variant="primary" size="sm">
          <Link href="/login?callbackUrl=/fathom">Entrar</Link>
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-separator1 bg-bg1 p-5 text-sm text-fg3 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Revisando conexión con Fathom…
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4">
      {!embedded && (
        <div className="space-y-1">
          <h2 className="text-lg font-light">Conectar Fathom</h2>
          <p className="text-sm text-fg3">
            Importa todas tus llamadas, las audita automáticamente y el coach
            high-ticket diseña tu estrategia de mejora. API key en{" "}
            <a
              href="https://fathom.video/settings/api"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Fathom → Settings → API
            </a>
            .
          </p>
        </div>
      )}

      {!status?.connected ? (
        <form onSubmit={onConnect} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="fathom-api-key">API key de Fathom</Label>
            <Input
              id="fathom-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="fathom_api_key_…"
              autoComplete="off"
            />
          </div>
          <Button type="submit" variant="primary" disabled={connecting || !apiKey.trim()}>
            {connecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Conectando…
              </>
            ) : (
              "Conectar Fathom"
            )}
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg2">
            <span className="inline-flex items-center rounded-full border border-separator1 px-2 py-0.5 text-xs">
              Conectado
            </span>
            {typeof status.total === "number" && (
              <span>
                {status.analyzed || 0} auditadas · {status.withTranscript || 0}/
                {status.total} con transcript
              </span>
            )}
            {status.lastSyncAt && (
              <span className="text-fg3">
                Última sync: {new Date(status.lastSyncAt).toLocaleString("es")}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={syncing || connecting}
              onClick={runFullPipeline}
            >
              {syncing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Importar, auditar y generar estrategia
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={syncing || connecting}
              onClick={onDisconnect}
            >
              <Unplug className="h-4 w-4" />
              Desconectar
            </Button>
            {coachReady && (
              <Button asChild variant="outline">
                <Link href="/coach">Ver estrategia del coach</Link>
              </Button>
            )}
          </div>
          {syncMessage && <p className="text-xs text-fg3">{syncMessage}</p>}
        </div>
      )}

      {recordings.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
            Llamadas importadas
          </p>
          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {recordings.map((row) => (
              <div
                key={row.id}
                className="rounded-xl border border-separator1 bg-bg0 px-3 py-2 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm truncate">{row.title}</p>
                  <p className="text-xs text-fg3">
                    {row.recordedAt
                      ? new Date(row.recordedAt).toLocaleString("es")
                      : "Sin fecha"}
                    {row.analyzed
                      ? " · auditada"
                      : row.hasTranscript
                        ? " · pendiente de auditar"
                        : " · sin transcript"}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {row.analyzed && row.practiceSessionId && (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/coach/${row.practiceSessionId}`}>Ver QC</Link>
                    </Button>
                  )}
                  {onAnalyze && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!row.hasTranscript || syncing}
                      onClick={() => pickRecording(row.id, row.title)}
                    >
                      {row.analyzed ? "Re-auditar" : "Auditar"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
