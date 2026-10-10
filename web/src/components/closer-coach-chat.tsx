"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CoachNotes } from "@/lib/closer-coach";
import { closerSpanish } from "@/lib/closer-spanish";
import { CoachMarkdown } from "@/components/coach-markdown";

type ChatLine = {
  id: string;
  role: "user" | "coach";
  content: string;
  createdAt?: string;
};

async function readApiJson(response: Response) {
  const text = await response.text();
  if (!text) {
    throw new Error(
      response.ok
        ? "El servidor no respondió"
        : "El coach no pudo cargarse. Recarga e inténtalo de nuevo.",
    );
  }
  try {
    return JSON.parse(text) as {
      error?: string;
      messages?: ChatLine[];
      message?: ChatLine;
      notes?: CoachNotes;
      level?: number;
    };
  } catch {
    throw new Error("El servidor devolvió un error. Recarga e inténtalo de nuevo.");
  }
}

export function CloserCoachChat({
  onNotes,
}: {
  onNotes?: (notes: CoachNotes, level: number) => void;
}) {
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(false);
  const startedRef = useRef(false);

  const applyNotes = (next: CoachNotes, nextLevel: number) => {
    onNotes?.(next, nextLevel);
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coach-chat")
      .then(async (r) => {
        const data = await readApiJson(r);
        if (!r.ok) throw new Error(data.error || "No se pudo cargar el coach");
        if (cancelled) return;
        setMessages(data.messages || []);
        if (data.notes) applyNotes(data.notes, data.level ?? 1);
        if ((data.messages || []).length === 0 && !startedRef.current) {
          startedRef.current = true;
          setSending(true);
          const start = await fetch("/api/coach-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ start: true }),
          });
          const startData = await readApiJson(start);
          if (!start.ok) throw new Error(startData.error || "No se pudo iniciar");
          if (cancelled) return;
          if (startData.message) {
            setMessages([startData.message]);
          } else if (startData.messages) {
            setMessages(startData.messages);
          }
          if (startData.notes) applyNotes(startData.notes, startData.level ?? 1);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setSending(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!stickRef.current) return;
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [messages, sending]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setError(null);
    stickRef.current = true;
    const optimistic: ChatLine = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);
    try {
      const response = await fetch("/api/coach-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "No se pudo responder");
      const coachMessage = data.message;
      if (coachMessage) {
        setMessages((prev) => [...prev, coachMessage]);
      }
      if (data.notes) applyNotes(data.notes, data.level ?? 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-[280px] max-h-[70vh] min-w-0 max-w-full flex-col overflow-x-hidden rounded-2xl border border-separator1 bg-bg1">
      <div ref={scrollerRef} className="min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-4">
        {loading && (
          <p className="text-sm text-fg3 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparando tu coach…
          </p>
        )}
        {messages.map((line) => (
          <div
            key={line.id}
            className={
              line.role === "user"
                ? "ml-8 min-w-0 break-words rounded-xl bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap"
                : "mr-4 min-w-0 break-words rounded-xl border border-separator1 bg-bg0 px-3 py-2 text-sm whitespace-pre-wrap"
            }
          >
            <p className="text-[10px] uppercase tracking-wide text-fg3 mb-1">
              {line.role === "user" ? "Tú" : "Coach"}
            </p>
            {line.role === "coach" ? (
              <CoachMarkdown text={closerSpanish(line.content)} />
            ) : (
              line.content
            )}
          </div>
        ))}
        {sending && !loading && (
          <p className="text-xs text-fg3 flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            El coach está tomando nota de tus prácticas…
          </p>
        )}
      </div>

      <form onSubmit={onSubmit} className="p-3 border-t border-separator1 space-y-2">
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex min-w-0 gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Cuéntale cómo te fue, pide el siguiente ejercicio, o di en qué te trabas…"
            className="min-h-[44px] w-full min-w-0 flex-1 text-sm"
            disabled={sending || loading}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={sending || loading || !draft.trim()}
            className="shrink-0 h-11"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
