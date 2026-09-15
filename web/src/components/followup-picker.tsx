"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { whatsappClickHref } from "@/lib/whatsapp-link";

export type FollowupOptionView = {
  id: string;
  source: "oferta" | "biblioteca" | "base";
  publisher: string;
  canal: string;
  recomendacion: string;
  mensaje: string;
  puntaje: number | null;
  uses: number;
};

export function FollowupPicker({
  alertId,
  options,
  selectedId,
  phone,
  disabled,
  onChoose,
}: {
  alertId: string;
  options: FollowupOptionView[];
  selectedId?: string;
  phone?: string;
  disabled?: boolean;
  onChoose: (alertId: string, optionId: string) => Promise<void> | void;
}) {
  const [copied, setCopied] = useState(false);
  if (!options.length) return null;
  const selected = options.find((row) => row.id === selectedId) || options[0];

  const sourceLabel = (row: FollowupOptionView) => {
    if (row.source === "oferta") return "Tu oferta";
    if (row.source === "biblioteca") return `@${row.publisher}`;
    return "Secuencia base";
  };

  const href = whatsappClickHref(phone || "", selected.mensaje);

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-fg3">
        Elige el mensaje ({options.length})
      </p>
      <div className="space-y-2">
        {options.map((row) => {
          const active = row.id === selected.id;
          return (
            <button
              key={row.id}
              type="button"
              disabled={disabled}
              onClick={() => void onChoose(alertId, row.id)}
              className={
                active
                  ? "w-full text-left rounded-lg border border-primary/40 bg-primary/5 p-2 space-y-1"
                  : "w-full text-left rounded-lg border border-separator1 bg-bg1 p-2 space-y-1 hover:border-fg3"
              }
            >
              <p className="text-[11px] text-fg3">
                {sourceLabel(row)} · {row.canal}
                {row.puntaje != null ? ` · puntaje ${row.puntaje}` : ""}
                {row.uses ? ` · ${row.uses} usos` : ""}
              </p>
              {row.recomendacion && (
                <p className="text-[11px] text-fg3">{row.recomendacion}</p>
              )}
              <p className="text-xs text-fg2 whitespace-pre-wrap">{row.mensaje}</p>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="primary" size="sm">
          <a href={href} target="_blank" rel="noreferrer">
            {phone ? "Abrir WhatsApp" : "WhatsApp (elige el chat)"}
          </a>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            void navigator.clipboard.writeText(selected.mensaje).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      {!phone && (
        <p className="text-[11px] text-fg3">
          No hay teléfono en la ficha. El extractor lo saca de la llamada, o
          dímelo en el chat.
        </p>
      )}
    </div>
  );
}
