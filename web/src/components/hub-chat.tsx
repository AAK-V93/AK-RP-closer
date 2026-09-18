"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Mic, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FollowupPicker, type FollowupOptionView } from "@/components/followup-picker";
import { OfferExtractReview } from "@/components/offer-extract-review";
import { Textarea } from "@/components/ui/textarea";
import type { ExtractedOffer } from "@/lib/offer-commercial";
import type { CommissionProjection } from "@/lib/crm-projection";

type Line = { id: string; role: "user" | "coach"; content: string };
type Action = { type?: string; href: string; label: string };
type PendingCall = {
  id: string;
  title: string;
  lines: string[];
  question?: string;
  field?: string;
};
type DueAlert = {
  id: string;
  question: string;
  leadName: string;
  mensajeSugerido?: string;
  enJuego?: number;
  tipo?: string;
  contexto?: string;
  opciones?: FollowupOptionView[];
  selectedId?: string;
  telefono?: string;
};

export type HubSnapshot = {
  home?: import("@/lib/home-state").HomeState;
  pendingCalls?: PendingCall[];
  alertsDue?: DueAlert[];
  appliedCalls?: string[];
  missingCrm?: { question: string } | null;
  readyCrm?: boolean;
  monthlyGoalUsd?: number | null;
  needsMonthlyGoal?: boolean;
  projection?: CommissionProjection | null;
  pendingOfferExtract?: {
    assumption: "una" | "varias";
    questions: string[];
    offers: ExtractedOffer[];
  } | null;
  needsPushPrompt?: boolean;
};

export function HubChat({
  variant = "page",
  initialSnapshot,
  onSnapshot,
}: {
  variant?: "page" | "dock";
  initialSnapshot?: HubSnapshot | null;
  onSnapshot?: () => void;
}) {
  const [messages, setMessages] = useState<Line[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [snapshot, setSnapshot] = useState<HubSnapshot>(initialSnapshot || {});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [focusAlert, setFocusAlert] = useState("");

  const applyPayload = (data: {
    message?: Line;
    actions?: Action[];
    snapshot?: HubSnapshot;
    messages?: Line[];
  }) => {
    if (data.messages?.length) setMessages(data.messages);
    if (data.message) {
      setMessages((prev) => [...prev, data.message as Line]);
    }
    if (data.actions) setActions(data.actions);
    if (data.snapshot) {
      setSnapshot(data.snapshot);
      onSnapshot?.();
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/hub")
      .then(async (r) => {
        const data = await r.json();
        if (cancelled) return;
        if (data.snapshot) setSnapshot(data.snapshot);
        if (Array.isArray(data.messages)) setMessages(data.messages);
        if (!r.ok && !data.snapshot) {
          throw new Error(data.error || "No se pudo cargar el inicio");
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("alert") || "";
    setFocusAlert(id);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const postHub = async (body: Record<string, unknown>) => {
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Error");
      applyPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSending(false);
    }
  };

  const sendText = async (text: string) => {
    if (!text || sending) return;
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: text },
    ]);
    await postHub({ message: text });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    await sendText(text);
  };

  const toggleMic = async () => {
    if (recording) {
      mediaRef.current?.stop();
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador no graba audio. Escribe el mensaje.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const type = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 200) return;
        setSending(true);
        setError(null);
        try {
          const body = new FormData();
          body.append("audio", blob, `hub.${type.includes("mp4") ? "m4a" : "webm"}`);
          const response = await fetch("/api/hub/transcribe", {
            method: "POST",
            body,
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "No se entendió");
          const text = String(data.text || "").trim();
          if (text) await sendText(text);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Error");
        } finally {
          setSending(false);
        }
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError("No pude usar el micrófono.");
    }
  };

  const pending = snapshot.pendingCalls || [];
  const alerts = snapshot.alertsDue || [];
  const dock = variant === "dock";

  return (
    <div
      className={
        dock
          ? "rounded-2xl border border-separator1 bg-bg1 flex flex-col"
          : "rounded-2xl border border-separator1 bg-bg1 flex flex-col min-h-[520px] max-h-[78vh]"
      }
    >
      <div className="px-4 py-3 border-b border-separator1">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
          {dock ? "Pendientes de hoy" : "Inicio"}
        </p>
        <p className="text-sm">
          {dock
            ? "Alertas, huecos del extractor y el chat abajo."
            : "Dime qué pasó o qué quieres hacer."}
        </p>
      </div>
      {(pending.length > 0 ||
        alerts.length > 0 ||
        snapshot.missingCrm ||
        snapshot.pendingOfferExtract ||
        (snapshot.appliedCalls || []).length > 0) && (
        <div className="px-4 pt-3 space-y-2 border-b border-separator1 pb-3">
          {(snapshot.appliedCalls || []).map((line) => (
            <p key={line} className="text-xs text-fg3">
              {line}
            </p>
          ))}
          {snapshot.pendingOfferExtract && (
            <OfferExtractReview
              batch={snapshot.pendingOfferExtract}
              saving={sending}
              onConfirm={(offers) => void postHub({ confirmOffers: offers })}
            />
          )}
          {snapshot.missingCrm && !pending.length && !snapshot.pendingOfferExtract && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm">{snapshot.missingCrm.question}</p>
              <p className="text-[11px] text-fg3 mt-1">
                Pega un bloque abajo, o súbelo en Ofertas. No hace falta ir dato por dato.
              </p>
            </div>
          )}
          {pending.map((call) => (
            <div
              key={call.id}
              className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2"
            >
              <p className="text-sm">{call.question || call.lines[0]}</p>
              <p className="text-[11px] text-fg3">{call.title}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={sending}
                  onClick={() => void postHub({ skipCallId: call.id })}
                >
                  No es comercial
                </Button>
              </div>
              <p className="text-[11px] text-fg3">Escribe la respuesta abajo.</p>
            </div>
          ))}
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={
                focusAlert === alert.id
                  ? "rounded-xl border border-primary bg-primary/10 p-3 space-y-2"
                  : "rounded-xl border border-separator1 bg-bg0 p-3 space-y-2"
              }
            >
              <p className="text-sm">{alert.question}</p>
              {alert.contexto && (
                <p className="text-[11px] text-fg3">{alert.contexto.split("\n")[0]}</p>
              )}
              {alert.tipo !== "AGENDA_CHECK" && (alert.opciones || []).length > 0 ? (
                <FollowupPicker
                  alertId={alert.id}
                  options={alert.opciones || []}
                  selectedId={alert.selectedId}
                  phone={alert.telefono}
                  disabled={sending}
                  onChoose={(id, optionId) =>
                    postHub({ pickScript: { id, optionId } })
                  }
                />
              ) : (
                alert.mensajeSugerido && (
                  <p className="text-xs text-fg2 whitespace-pre-wrap rounded-lg bg-bg1 p-2">
                    {alert.mensajeSugerido}
                  </p>
                )
              )}
              <div className="flex flex-wrap gap-2">
                {alert.tipo === "AGENDA_CHECK" ? (
                  (
                    [
                      ["SHOW", "Show (sin grabación)"],
                      ["NO SHOW", "No show"],
                      ["REPROGRAMA", "Reprogramó"],
                    ] as const
                  ).map(([estado, label]) => (
                    <Button
                      key={estado}
                      size="sm"
                      variant={estado === "SHOW" ? "primary" : "outline"}
                      disabled={sending}
                      onClick={() =>
                        void postHub({
                          agendaOutcome: { id: alert.id, estado },
                        })
                      }
                    >
                      {label}
                    </Button>
                  ))
                ) : (
                  (
                    [
                      ["hecho", "Hecho"],
                      ["no_contesto", "No contestó"],
                      ["reprogramado", "Reprogramar"],
                      ["cerro", "Cerró"],
                      ["perdido", "Perdido"],
                    ] as const
                  ).map(([resultado, label]) => (
                    <Button
                      key={resultado}
                      size="sm"
                      variant={resultado === "hecho" ? "primary" : "outline"}
                      disabled={sending}
                      onClick={() =>
                        void postHub({
                          alertOutcome: { id: alert.id, resultado },
                        })
                      }
                    >
                      {label}
                    </Button>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className={dock ? "max-h-48 overflow-y-auto p-4 space-y-3" : "flex-1 overflow-y-auto p-4 space-y-3"}>
        {loading && (
          <p className="text-sm text-fg3 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparando…
          </p>
        )}
        {messages.map((line) => (
          <div
            key={line.id}
            className={
              line.role === "user"
                ? "ml-8 rounded-xl bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap"
                : "mr-4 rounded-xl border border-separator1 bg-bg0 px-3 py-2 text-sm whitespace-pre-wrap"
            }
          >
            {line.content}
          </div>
        ))}
        {sending && (
          <p className="text-xs text-fg3 flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            …
          </p>
        )}
        <div ref={bottomRef} />
      </div>
      {actions.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button key={action.href + action.label} asChild size="sm" variant="primary">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ))}
        </div>
      )}
      <form onSubmit={onSubmit} className="p-3 border-t border-separator1 space-y-2">
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Escribe o graba: agendé a Juan, me pagaron, falta el precio…"
            className="min-h-[44px] text-sm"
            disabled={sending || loading || recording}
          />
          <Button
            type="button"
            variant={recording ? "destructive" : "outline"}
            disabled={sending || loading}
            onClick={() => void toggleMic()}
            aria-label={recording ? "Detener" : "Grabar"}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Button type="submit" variant="primary" disabled={sending || !draft.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
