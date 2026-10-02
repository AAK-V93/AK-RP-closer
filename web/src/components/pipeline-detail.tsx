"use client";

import { useState } from "react";
import { pipelineDetailGroups, sinPrecioNote, type PipelineLine } from "@/lib/crm-pipeline";

/** Expandable per-lead breakdown. Wraps at 375px. */
export function PipelineDetail({
  lines,
  format,
}: {
  lines: PipelineLine[];
  format: (amount: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const [zerosOpen, setZerosOpen] = useState(false);
  const { priced, unpriced } = pipelineDetailGroups(lines);
  const sum = lines.reduce((total, row) => total + row.amount, 0);
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="inline-flex min-h-11 items-center text-sm text-tone-info underline-offset-2 hover:underline lg:min-h-0"
        onClick={() =>
          setOpen((value) => {
            if (value) setZerosOpen(false);
            return !value;
          })
        }
      >
        {open ? "Ocultar detalle" : "Ver detalle"}
      </button>
      {open && (
        <div className="mt-2 min-w-0">
          {lines.length === 0 ? (
            <p className="text-sm text-fg3">Ningún lead abierto en este total.</p>
          ) : (
            <ul className="divide-y divide-separator1 border-t border-separator1 text-sm">
              {priced.map((row, index) => (
                <li key={`${row.name}-${index}`} className="min-w-0 py-2">
                  <span className="block break-words">{row.name}</span>
                  <span className="block break-words text-xs text-fg3">
                    {format(row.amount)} · {row.fuente}
                  </span>
                </li>
              ))}
              {unpriced.length > 0 && (
                <li className="min-w-0 py-2">
                  <button
                    type="button"
                    className="flex min-h-11 w-full min-w-0 items-center gap-2 text-left lg:min-h-0 lg:items-start"
                    aria-expanded={zerosOpen}
                    onClick={() => setZerosOpen((value) => !value)}
                  >
                    <span aria-hidden className="shrink-0 text-fg3">
                      {zerosOpen ? "▾" : "▸"}
                    </span>
                    <span className="break-words">{sinPrecioNote(unpriced.length)}</span>
                  </button>
                  {zerosOpen && (
                    <ul className="mt-1 min-w-0 border-l border-separator1 pl-3">
                      {unpriced.map((row, index) => (
                        <li key={`${row.name}-${index}`} className="break-words py-1 text-sm">
                          {row.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )}
            </ul>
          )}
          <p className="mt-2 break-words text-xs text-fg3">
            {sinPrecioNote(unpriced.length)}. La suma del detalle es {format(sum)}.
          </p>
        </div>
      )}
    </div>
  );
}
