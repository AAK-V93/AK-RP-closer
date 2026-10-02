"use client";

import { useState } from "react";
import { sinPrecioNote, type PipelineLine } from "@/lib/crm-pipeline";

/** Expandable per-lead breakdown. Wraps at 375px. */
export function PipelineDetail({
  lines,
  format,
}: {
  lines: PipelineLine[];
  format: (amount: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const zeros = lines.filter((row) => row.amount <= 0).length;
  const sum = lines.reduce((total, row) => total + row.amount, 0);
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="text-sm text-tone-info underline-offset-2 hover:underline"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Ocultar detalle" : "Ver detalle"}
      </button>
      {open && (
        <div className="mt-2 min-w-0">
          {lines.length === 0 ? (
            <p className="text-sm text-fg3">Ningún lead abierto en este total.</p>
          ) : (
            <ul className="divide-y divide-separator1 border-t border-separator1 text-sm">
              {lines.map((row, index) => (
                <li key={`${row.name}-${index}`} className="min-w-0 py-2">
                  <span className="block break-words">{row.name}</span>
                  <span className="block break-words text-xs text-fg3">
                    {format(row.amount)} · {row.fuente}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 break-words text-xs text-fg3">
            {sinPrecioNote(zeros)}. La suma del detalle es {format(sum)}.
          </p>
        </div>
      )}
    </div>
  );
}
