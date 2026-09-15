"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FollowupPicker, type FollowupOptionView } from "@/components/followup-picker";
import { Textarea } from "@/components/ui/textarea";

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

type Snapshot = {
  pendingCalls?: PendingCall[];
  alertsDue?: DueAlert[];
  appliedCalls?: string[];
  missingCrm?: { question: string } | null;
  readyCrm?: boolean;
};

export function HubChat() {
  const [messages, setMessages] = useState<Line[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const started = useRef(false);

  const applyPayload = (data: {
    message?: Line;
    actions?: Action[];
    snapshot?: Snapshot;
    messages?: Line[];
  }) => {
    if (data.messages?.length) setMessages(data.messages);
    if (data.message) {
      setMessages((prev) => [...prev, data.message as Line]);
    }
    if (data.actions) setActions(data.actions);
    if (data.snapshot) setSnapshot(data.snapshot);
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/hub")
      .then((r) => r.json())
      .then(async (data) => {
        if (cancelled) return;
        if (data.snapshot) setSnapshot(data.snapshot);
        if (data.messages?.length) {
          setMessages(data.messages);
          setLoading(false);
          return;
        }
        if (started.current) return;
        started.current = true;
        const start = await fetch("/api/hub", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: true }),
        });
        const startData = await start.json();
        if (!start.ok) throw new Error(startData.error || "No se pudo iniciar");
        if (startData.message) setMessages([startData.message]);
        setActions(startData.actions || []);
        if (startData.snapshot) setSnapshot(startData.snapshot);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
    return () => {
      cancelled = true;
    };
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

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: text },
    ]);
    await postHub({ message: text });
  };

  const pending = snapshot.pendingCalls || [];
  const alerts = snapshot.alertsDue || [];

  return (
    <div className="rounded-2xl border border-separator1 bg-bg1 flex flex-col min-h-[520px] max-h-[78vh]">
      <div className="px-4 py-3 border-b border-separator1">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
          Inicio
        </p>
        <p className="text-sm">Dime qué pasó o qué quieres hacer.</p>
      </div>
      {(pending.length > 0 || alerts.length > 0 || snapshot.missingCrm || (snapshot.appliedCalls || []).length > 0) && (
        <div className="px-4 pt-3 space-y-2 border-b border-separator1 pb-3">
          {(snapshot.appliedCalls || []).map((line) => (
            <p key={line} className="text-xs text-fg3">
              {line}
            </p>
          ))}
          {snapshot.missingCrm && !pending.length && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm">{snapshot.missingCrm.question}</p>
              <p className="text-[11px] text-fg3 mt-1">Responde abajo. Un dato a la vez.</p>
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
              className="rounded-xl border border-separator1 bg-bg0 p-3 space-y-2"
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
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
            placeholder="12000 · 3% hasta 70k · agendé a Juan el jueves · ¿cómo voy este mes?"
            className="min-h-[44px] text-sm"
            disabled={sending || loading}
          />
          <Button type="submit" variant="primary" disabled={sending || !draft.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
