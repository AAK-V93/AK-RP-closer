"use client";

import { useState } from "react";
import { offerDescriptionPreview } from "@/lib/offer-transcripts";

/** The offer description in whole sentences, never cut with «…», with a button for the rest. */
export function OfferDescription({ name, description, fallback = "" }: { name: string; description: string; fallback?: string }) {
  const [open, setOpen] = useState(false);
  const text = offerDescriptionPreview(name, description);
  const full = text.full || fallback.replace(/…$/, "").trim();
  if (!full) return null;
  const long = Boolean(text.full) && text.long;
  return (
    <div className="space-y-1">
      <p className="whitespace-pre-wrap text-sm text-fg2 text-pretty">{open || !long ? full : text.preview}</p>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          className="min-h-11 text-sm font-medium text-fg0 underline"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Ver menos" : "Ver la descripción completa"}
        </button>
      )}
    </div>
  );
}
