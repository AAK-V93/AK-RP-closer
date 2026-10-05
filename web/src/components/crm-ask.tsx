"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { answerCrmFollowups, type CrmAskRow } from "@/lib/crm-ask";
import { openFollowupCountOf } from "@/lib/crm-followups";
import { countPhrase } from "@/lib/plain-labels";

type Line = { role: "user" | "crm"; text: string };

const SUGGESTIONS = ["¿A quién hoy?", "¿Cuándo?", "¿Cómo les escribo?"];

/** 1200px, not xl/1280: a laptop window of 1280 loses ~15px to the scrollbar. */
const SIDE_COLUMN_QUERY = "(min-width: 1200px)";

export function CrmAsk({
  rows,
  money,
  hidden = false,
}: {
  rows: CrmAskRow[];
  money: (value: number) => string;
  hidden?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines, expanded]);

  useEffect(() => {
    if (!expanded) return;
    fieldRef.current?.focus();
  }, [expanded]);

  const ask = (question: string) => {
    const text = question.trim();
    if (!text) return;
    const answer = answerCrmFollowups(rows, text, { money });
    setLines((prev) => [...prev, { role: "user", text }, { role: "crm", text: answer }]);
    setDraft("");
    setExpanded(true);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    ask(draft);
  };

  if (hidden) return null;

  return (
    <aside className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 z-30 min-w-0 max-w-full bg-bg0 min-[1200px]:static min-[1200px]:inset-auto min-[1200px]:z-auto min-[1200px]:max-h-[calc(100vh-7rem)] min-[1200px]:sticky min-[1200px]:top-4 min-[1200px]:flex min-[1200px]:flex-col min-[1200px]:border min-[1200px]:border-separator1">
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
          placeholder="¿A quién le escribo hoy?"
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
        <div className="flex items-center justify-between gap-2 border-b border-separator1 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-fg3">Seguimientos</p>
            <p className="text-sm">Pregunta a quién, cuándo y cómo</p>
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
          <p className="text-xs text-fg3">
            Responde con lo que ya está en el CRM, sin esperar. {countPhrase(openFollowupCountOf(rows), "seguimiento abierto", "seguimientos abiertos")}.
          </p>
          {lines.map((line, index) => (
            <p
              key={`${line.role}-${index}`}
              className={
                line.role === "user"
                  ? "min-w-0 whitespace-pre-wrap break-words text-sm"
                  : "min-w-0 whitespace-pre-wrap break-words border border-separator1 bg-bg1 p-2 text-sm"
              }
            >
              {line.text}
            </p>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="space-y-2 border-t border-separator1 p-3">
          <div className="flex min-w-0 flex-wrap gap-1">
            {SUGGESTIONS.map((item) => (
              <Button key={item} type="button" size="sm" variant="outline" onClick={() => ask(item)}>
                {item}
              </Button>
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
                  ask(draft);
                }
              }}
              placeholder="¿A quién le escribo hoy?"
              rows={2}
              className="min-h-0 min-w-0 flex-1"
            />
            <Button type="submit" size="sm" variant="primary" aria-label="Preguntar" className="shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </aside>
  );
}
