"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defaultImportSinceDate, toDateInputValue } from "@/lib/fathom-import";
import { countPhrase } from "@/lib/plain-labels";

type FathomStatus = {
  connected: boolean;
  lastSyncAt?: string | null;
  importSince?: string | null;
  autoIngest?: boolean;
  total?: number;
  withTranscript?: number;
  analyzed?: number;
  skipped?: number;
};

const FATHOM_API_SETTINGS = "https://fathom.video/settings/api";

function FathomApiKeyHelp() {
  return (
    <div className="rounded-xl border border-separator1 bg-bg0 p-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
        Dónde está la clave
      </p>
      <ol className="text-sm text-fg2 space-y-1.5 list-decimal pl-4">
        <li>
          Entra a{" "}
          <a
            href="https://fathom.video"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            fathom.video
          </a>{" "}
          con la cuenta con la que grabas.
        </li>
        <li>
          Arriba a la derecha: <span className="text-fg1">Settings</span> (Ajustes). Baja
          hasta <span className="text-fg1">API Access</span> (la clave, en My Settings).
        </li>
        <li>
          Toca <span className="text-fg1">Add</span> (Agregar) →{" "}
          <span className="text-fg1">Generate API Key</span> (Crear clave). Ponle un nombre
          (ej. Closer Trainer) y <span className="text-fg1">Create API Client</span> (Crear).
        </li>
        <li>Cópiala ya: la app la muestra una sola vez. Pégala abajo.</li>
      </ol>
      <a
        href={FATHOM_API_SETTINGS}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-sm underline lg:min-h-0 lg:min-w-0"
      >
        Abrir la app de grabación → Ajustes → clave
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

type FathomRecordingRow = {
  id: string;
  title: string;
  shareUrl: string;
  recordedAt: string | null;
  hasTranscript: boolean;
  analyzed: boolean;
  skipped?: boolean;
  practiceSessionId: string | null;
};

export function FathomSyncPanel({
  authenticated,
}: {
  authenticated: boolean;
  onAnalyze?: (args: { transcript: string; title: string }) => void;
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
  const [importSince, setImportSince] = useState(defaultImportSinceDate);

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
        throw new Error(connectionData.error || "No se pudo leer las grabaciones");
      }
      setStatus(connectionData);
      if (connectionData.importSince) {
        setImportSince(toDateInputValue(new Date(connectionData.importSince)));
      }
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

  const postJson = async <T,>(url: string, body?: object): Promise<T> => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = (await response.json()) as T & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Error de red");
        }
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Error de red");
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
        }
      }
    }
    throw lastError || new Error("Error de red");
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
        const data: {
          nextCursor?: string | null;
          meetingsDone?: boolean;
        } = await postJson("/api/fathom/sync", {
          phase: "meetings",
          cursor,
          createdAfter: importSince,
        });
        setSyncMessage("Trayendo llamadas grabadas…");
        cursor = data.nextCursor || null;
        meetingsDone = Boolean(data.meetingsDone);
        if (!meetingsDone && !cursor) break;
      }

      let transcriptsDone = false;
      let transcriptStalls = 0;
      while (!transcriptsDone) {
        const data = await postJson<{
          remainingTranscripts?: number;
          done?: boolean;
          skipped?: number;
          imported?: number;
          waitMs?: number;
        }>("/api/fathom/sync", {
          phase: "transcripts",
          createdAfter: importSince,
        });
        const remaining = data.remainingTranscripts ?? 0;
        if (data.waitMs) {
          transcriptStalls += 1;
          setSyncMessage(
            remaining > 0
              ? `La app de grabación pidió espera. Reintento en unos segundos… faltan ${remaining}`
              : "La app de grabación pidió espera. Reintento en unos segundos…",
          );
          if (transcriptStalls >= 6) {
            setSyncMessage(
              "La app de grabación limitó las peticiones. Sigo con las que sí bajaron; el resto se reintenta al traerlas de nuevo.",
            );
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, data.waitMs));
          continue;
        }
        transcriptStalls = 0;
        setSyncMessage(
          remaining > 0
            ? `Descargando transcripciones… faltan ${remaining}`
            : "Transcripciones listas. Auditando llamadas…",
        );
        transcriptsDone = Boolean(data.done);
      }

      let analyzeDone = false;
      while (!analyzeDone) {
        const data = await postJson<{
          remaining?: number;
          done?: boolean;
          imported?: number;
          skipped?: number;
          recording?: { title?: string; skipped?: boolean; leadName?: string };
          partial?: boolean;
        }>("/api/fathom/analyze");
        const remaining = data.remaining ?? 0;
        if (data.skipped && data.recording?.title) {
          setSyncMessage(`Sin audio ni transcripción: ${data.recording.title}`);
        } else if (data.recording?.title) {
          setSyncMessage(
            data.partial
              ? `Guardada (QC parcial): ${data.recording.title}`
              : `Auditada: ${data.recording.title}${remaining > 0 ? ` · faltan ${remaining}` : ""}`,
          );
        } else {
          setSyncMessage(
            remaining > 0
              ? `Auditando llamadas… faltan ${remaining}`
              : "Llamadas auditadas. El coach está diseñando tu estrategia…",
          );
        }
        analyzeDone = Boolean(data.done);
        if (data.imported === 0 && data.skipped === 0 && data.done) break;
      }

      const coachData = await postJson<{
        analyzedCount?: number;
        message?: string;
      }>("/api/fathom/coach-strategy");

      setCoachReady((coachData.analyzedCount || 0) > 0);
      setSyncMessage(
        coachData.analyzedCount
          ? `Listo: ${countPhrase(coachData.analyzedCount, "llamada auditada", "llamadas auditadas")}. Tu coach ya tiene la estrategia en Mi coaching.`
          : coachData.message ||
            "No hubo llamadas auditables en ese rango. Amplía la fecha de inicio.",
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
    setSyncing(true);
    setError(null);
    setSyncMessage(`Auditando ${title}…`);
    try {
      const data = await postJson<{
        recording?: { practiceSessionId?: string; title?: string };
        partial?: boolean;
      }>("/api/fathom/analyze", { recordingId: id });
      await load();
      const sessionId = data.recording?.practiceSessionId;
      if (sessionId) {
        window.location.href = `/coach/${sessionId}`;
        return;
      }
      setSyncMessage(
        data.partial
          ? `Guardada (QC parcial): ${data.recording?.title || title}`
          : `No pude auditar ${title}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setSyncMessage(null);
    } finally {
      setSyncing(false);
    }
  };

  if (!authenticated) {
    return (
      <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-2">
        <h2 className="text-lg font-light">Conectar tus grabaciones</h2>
        <p className="text-sm text-fg3">
          Conecta las grabaciones de tus reuniones para que las llamadas nuevas entren solas al CRM.
          Necesitas una cuenta.
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
        Revisando la conexión…
      </div>
    );
  }

  return (
    <div
      id="conectar-fathom"
      className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-light">Conectar tus grabaciones</h2>
        <p className="text-sm text-fg3">
          {status?.connected
            ? "Las llamadas nuevas entran solas cuando termina la transcripción. El botón de abajo trae el historial."
            : "Pega la clave de la app que graba tus reuniones (Fathom). Las llamadas nuevas entran solas cuando termina la transcripción."}
        </p>
      </div>

      {!status?.connected ? (
        <form onSubmit={onConnect} className="space-y-3">
          <FathomApiKeyHelp />
          <div className="space-y-1">
            <Label htmlFor="fathom-api-key">Clave de las grabaciones</Label>
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
              "Conectar grabaciones"
            )}
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg2">
            <span className="inline-flex items-center rounded-full border border-separator1 px-2 py-0.5 text-xs">
              {status.autoIngest ? "Entrada automática" : "Conectado"}
            </span>
            {typeof status.total === "number" && (
              <span>
                {status.analyzed || 0} revisadas · {status.withTranscript || 0} con
                transcripción
                {status.skipped ? ` · ${status.skipped} omitidas` : ""}
              </span>
            )}
            {status.lastSyncAt && (
              <span className="text-fg3">
                Última actualización: {new Date(status.lastSyncAt).toLocaleString("es")}
              </span>
            )}
          </div>
          <div className="space-y-1 max-w-xs">
            <Label htmlFor="fathom-import-since">Importar desde</Label>
            <Input
              id="fathom-import-since"
              type="date"
              value={importSince}
              onChange={(e) => setImportSince(e.target.value)}
              disabled={syncing || connecting}
            />
            <p className="text-xs text-fg3">
              {status.autoIngest
                ? "Las nuevas llegan solas. El botón reintenta las omitidas de este rango y re-audita las que quedaron a medias."
                : "En local no puede entrar sola (la app de grabación necesita HTTPS). En producción se activa al abrir esta pantalla. El botón trae el historial y reintenta las omitidas."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={syncing || connecting || !importSince}
              onClick={runFullPipeline}
              className="whitespace-normal h-auto min-h-11 text-center"
            >
              {syncing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Traer llamadas y preparar el coach
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
                  <p className="text-sm truncate" title={row.title}>
                    {row.title}
                  </p>
                  <p className="text-xs text-fg3">
                    {row.recordedAt
                      ? new Date(row.recordedAt).toLocaleString("es")
                      : "Sin fecha"}
                    {row.analyzed
                      ? " · auditada"
                      : row.skipped
                        ? " · omitida"
                        : row.hasTranscript
                          ? " · pendiente de auditar"
                          : " · sin transcripción"}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {row.analyzed && row.practiceSessionId && (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/coach/${row.practiceSessionId}`}>Ver QC</Link>
                    </Button>
                  )}
                  {row.hasTranscript && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={syncing}
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
