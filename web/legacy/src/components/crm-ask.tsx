"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Mic, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { answerCrmFollowups, crmAskRoute, type CrmAskRow } from "@/lib/crm-ask";
import { chatSuggestions, writeWithContext } from "@/lib/crm-chat";
import { resolvePerson } from "@/lib/person-resolve";
import { openFollowupCountOf } from "@/lib/crm-followups";
import { countPhrase } from "@/lib/plain-labels";

type Line = { role: "user" | "crm"; text: string };


/** 1200px, not xl/1280: a laptop window of 1280 loses ~15px to the scrollbar. */
const SIDE_COLUMN_QUERY = "(min-width: 1200px)";

export function CrmAsk({
  rows,
  money,
  hidden = false,
  seed,
  onSeedConsumed,
  onChanged,
}: {
  rows: CrmAskRow[];
  money: (value: number) => string;
  hidden?: boolean;
  seed?: { id: number; text: string } | null;
  onSeedConsumed?: () => void;
  onChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, setPending] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const seedSeen = useRef(0);
  const pendingRef = useRef("");
  pendingRef.current = pending;
  const contextRef = useRef<string | null>(null);
  /** Who the chat is talking about, so «él me pagó 500» goes to that person. */
  const contextPersonRef = useRef<{ name: string; leadId?: string } | null>(null);
  // The chips follow the person the chat is about.
  const [contextName, setContextName] = useState("");
  const [contextStatus, setContextStatus] = useState("");
  const remember = (person: { name: string; leadId?: string }, status = "") => {
    contextPersonRef.current = person;
    setContextName(person.name);
    setContextStatus(status);
  };
  /** A write that said «él/ella» with nobody in the chat yet: waits for the name. */
  const awaitingWhoRef = useRef("");
  const linesRef = useRef<Line[]>([]);
  linesRef.current = lines;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines, expanded, pending]);

  useEffect(() => {
    if (!expanded) return;
    fieldRef.current?.focus();
  }, [expanded]);

  const push = (text: string, role: Line["role"]) => {
    setLines((prev) => [...prev, { role, text }]);
  };

  const askHub = async (text: string, sent = text) => {
    setSending(true);
    push(text, "user");
    try {
      const response = await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: sent }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: { content?: string };
      };
      const reply = String(data.message?.content || data.error || "No pude completar eso. Inténtalo otra vez.").trim();
      const confirm = /¿Confirmo\?/i.test(reply);
      if (confirm) {
        setPending(reply);
      } else {
        setPending("");
        push(reply, "crm");
        onChanged?.();
      }
    } catch {
      setPending("");
      push("No pude completar eso. Inténtalo otra vez.", "crm");
    } finally {
      setSending(false);
    }
  };

  const askPerson = async (text: string) => {
    setSending(true);
    push(text, "user");
    try {
      const response = await fetch("/api/crm/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          contextId: contextRef.current,
          history: linesRef.current.slice(-6),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        kind?: "list" | "answer";
        reply?: string;
        contextId?: string | null;
        name?: string;
        leadId?: string;
        status?: string;
      };
      if (data.kind === "list") {
        push(answerCrmFollowups(rows, text, { money }), "crm");
        return;
      }
      if (data.contextId) contextRef.current = data.contextId;
      if (data.name) remember({ name: data.name, leadId: data.leadId || undefined }, data.status || "");
      push(String(data.reply || "No pude completar eso. Inténtalo otra vez.").trim(), "crm");
    } catch {
      push(answerCrmFollowups(rows, text, { money }), "crm");
    } finally {
      setSending(false);
    }
  };

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || sending) return;
    setDraft("");
    setExpanded(true);
    const people = rows.map((row) => ({ id: row.id, name: row.cliente }));
    const waiting = awaitingWhoRef.current;
    if (waiting) {
      awaitingWhoRef.current = "";
      const who = resolvePerson(text, people, { useContext: false });
      if (who.kind === "one") {
        remember({ name: who.person.name });
        const target = writeWithContext(waiting, people, contextPersonRef.current);
        if (target.kind === "send") {
          await askHub(text, target.text);
          return;
        }
      }
    }
    if (crmAskRoute(text, Boolean(pendingRef.current)) === "hub") {
      // «él me pagó 500» → the person the chat is about, before the ¿Confirmo? / Guardar step.
      const target = writeWithContext(text, people, contextPersonRef.current);
      if (target.kind === "ask") {
        awaitingWhoRef.current = text;
        push(text, "user");
        push(target.reply, "crm");
        return;
      }
      if (target.name) remember({ name: target.name, leadId: target.leadId });
      await askHub(text, target.text);
      return;
    }
    await askPerson(text);
  };

  // Guardar / No: the proposal card goes away at once, without waiting for the answer.
  const answerProposal = (word: "sí" | "no") => {
    if (sending) return;
    void ask(word);
    setPending("");
  };

  useEffect(() => {
    if (!seed || seed.id === seedSeen.current) return;
    seedSeen.current = seed.id;
    void ask(seed.text);
    onSeedConsumed?.();
    // ask identity changes every render; the seed id is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };

  const toggleMic = async () => {
    if (recording) {
      mediaRef.current?.stop();
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 200) return;
        try {
          const body = new FormData();
          body.append("audio", blob, "hub.webm");
          const response = await fetch("/api/hub/transcribe", { method: "POST", body });
          const data = await response.json();
          const text = String(data.text || "").trim();
          if (text) await ask(text);
        } catch {
          push("No pude usar el micrófono. Escríbelo.", "crm");
        }
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      push("No pude usar el micrófono. Escríbelo.", "crm");
    }
  };

  if (hidden) return null;

  const openCount = countPhrase(openFollowupCountOf(rows), "persona en seguimiento", "personas en seguimiento");

  return (
    <aside className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 z-30 min-w-0 max-w-full bg-bg0 min-[1200px]:static min-[1200px]:inset-auto min-[1200px]:z-auto min-[1200px]:max-h-[calc(100vh-7rem)] min-[1200px]:sticky min-[1200px]:top-4 min-[1200px]:flex min-[1200px]:flex-col min-[1200px]:rounded-2xl min-[1200px]:border min-[1200px]:border-separator1 min-[1200px]:bg-bg1">
      <form
        className={
          expanded
            ? "hidden"
            : "flex h-16 max-h-16 min-w-0 items-center gap-2 border-t border-separator1 px-3 min-[1200px]:hidden"
        }
        onSubmit={(event) => {
          event.preventDefault();
          setExpanded(true);
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setExpanded(true)}
          placeholder="Pregúntame por tus prospectos"
          aria-label="Preguntar seguimientos"
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="primary" size="sm" className="shrink-0">
          Preguntar
        </Button>
      </form>

      <div
        className={
          expanded
            ? "flex max-h-[70vh] min-h-0 min-w-0 flex-col min-[1200px]:max-h-[calc(100vh-7rem)]"
            : "hidden min-h-0 min-w-0 flex-col min-[1200px]:flex min-[1200px]:max-h-[calc(100vh-7rem)]"
        }
      >
        <div className="flex items-start justify-between gap-2 border-b border-separator1 px-4 py-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold leading-tight text-fg0">Pregúntame por tus prospectos</p>
            <p className="mt-1 text-[13px] text-fg3">
              Conozco cada llamada, pago y mensaje. Antes de cambiar algo, te pregunto. {openCount}.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 min-[1200px]:hidden"
            onClick={() => setExpanded(false)}
          >
            Cerrar
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {lines.map((line, index) => (
            <p
              key={`${line.role}-${index}`}
              className={
                line.role === "user"
                  ? "ml-8 min-w-0 whitespace-pre-wrap break-words rounded-2xl bg-fg0 px-3 py-2 text-sm text-[#FBF8F2]"
                  : "mr-4 min-w-0 whitespace-pre-wrap break-words rounded-2xl border border-separator1 bg-bg0 p-3 text-sm text-fg0"
              }
            >
              {line.text}
            </p>
          ))}
          {pending && (
            <div className="rounded-2xl border border-separator2 bg-bg0 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-fg3">Cambio propuesto</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-fg0">{pending.replace(/\s*¿Confirmo\?\s*$/i, "")}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => answerProposal("sí")}
                  className="inline-flex h-11 min-h-11 items-center rounded-[10px] bg-fg0 px-3.5 text-sm font-medium text-[#FBF8F2] disabled:opacity-60"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => answerProposal("no")}
                  className="inline-flex h-11 min-h-11 items-center rounded-[10px] border border-separator2 px-3.5 text-sm font-medium text-fg0 disabled:opacity-60"
                >
                  No
                </button>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="space-y-2 border-t border-separator1 p-3">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {chatSuggestions(contextName, contextStatus).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => void ask(item)}
                className="inline-flex h-11 min-h-11 items-center rounded-full border border-separator2 px-3 text-[13px] text-fg2"
              >
                {item}
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="flex min-w-0 items-end gap-2">
            <Textarea
              ref={fieldRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask(draft);
                }
              }}
              placeholder="Escribe o habla…"
              rows={2}
              aria-label="Preguntar seguimientos"
              className="min-h-0 min-w-0 flex-1"
            />
            <Button
              type="button"
              variant={recording ? "destructive" : "outline"}
              size="sm"
              disabled={sending && !recording}
              onClick={() => void toggleMic()}
              aria-label={recording ? "Detener" : "Hablar"}
              className="shrink-0"
            >
              {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button type="submit" size="sm" variant="primary" aria-label="Preguntar" className="shrink-0" disabled={sending}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </aside>
  );
}
