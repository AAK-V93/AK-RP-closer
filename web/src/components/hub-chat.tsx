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

export type HubSnapshot = {
  home?: import("@/lib/home-state").HomeState;
  pendingCalls?: PendingCall[];
  alertsDue?: DueAlert[];
  appliedCalls?: string[];
  missingCrm?: { question: string } | null;
  readyCrm?: boolean;
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
  const bottomRef = useRef<HTMLDivElement | null>(null);

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
            placeholder="Escribe aquí: agendé a Juan, me pagaron, falta el precio…"
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
