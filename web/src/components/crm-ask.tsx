"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { answerCrmFollowups, type CrmAskRow } from "@/lib/crm-ask";
import { countPhrase } from "@/lib/plain-labels";

type Line = { role: "user" | "crm"; text: string };

const SUGGESTIONS = ["¿A quién hoy?", "¿Cuándo?", "¿Cómo les escribo?"];

export function CrmAsk({
  rows,
  money,
  hidden = false,
}: {
  rows: CrmAskRow[];
  money: (value: number) => string;
  hidden?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1280px)").matches;
    setOpen(wide);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines, open]);

  const ask = (question: string) => {
    const text = question.trim();
    if (!text) return;
    const answer = answerCrmFollowups(rows, text, { money });
    setLines((prev) => [...prev, { role: "user", text }, { role: "crm", text: answer }]);
    setDraft("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    ask(draft);
  };

  if (hidden) return null;

  if (!open) {
    return (
      <div className="fixed bottom-4 right-4 z-30 xl:static xl:z-auto">
        <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
          Preguntar seguimientos
        </Button>
      </div>
    );
  }

  return (
    <aside className="fixed inset-x-3 bottom-3 z-30 flex max-h-[70vh] flex-col border border-separator1 bg-bg0 xl:static xl:inset-auto xl:z-auto xl:max-h-[calc(100vh-7rem)] xl:sticky xl:top-4">
      <div className="flex items-center justify-between gap-2 border-b border-separator1 px-3 py-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-fg3">Seguimientos</p>
          <p className="text-sm">Pregunta a quién, cuándo y cómo</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cerrar
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <p className="text-xs text-fg3">
          Responde con lo que ya está en el CRM, sin esperar. {countPhrase(rows.length, "seguimiento abierto", "seguimientos abiertos")}.
        </p>
        {lines.map((line, index) => (
          <p
            key={`${line.role}-${index}`}
            className={
              line.role === "user"
                ? "whitespace-pre-wrap text-sm"
                : "whitespace-pre-wrap border border-separator1 bg-bg1 p-2 text-sm"
            }
          >
            {line.text}
          </p>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="space-y-2 border-t border-separator1 p-3">
        <div className="flex flex-wrap gap-1">
          {SUGGESTIONS.map((item) => (
            <Button key={item} type="button" size="sm" variant="outline" onClick={() => ask(item)}>
              {item}
            </Button>
          ))}
        </div>
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <Textarea
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
            className="min-h-0"
          />
          <Button type="submit" size="sm" variant="primary" aria-label="Preguntar">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </aside>
  );
}
