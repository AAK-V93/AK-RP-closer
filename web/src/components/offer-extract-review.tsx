"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { commercialRecap, collapseOffersToOne, type ExtractedOffer } from "@/lib/offer-commercial";

export type OfferExtractReviewBatch = {
  assumption: "una" | "varias";
  questions: string[];
  offers: ExtractedOffer[];
};

export function OfferExtractReview({
  batch,
  saving,
  onBack,
  onConfirm,
}: {
  batch: OfferExtractReviewBatch;
  saving?: boolean;
  onBack?: () => void;
  onConfirm: (offers: ExtractedOffer[]) => void;
}) {
  const [mode, setMode] = useState<"una" | "varias">(
    batch.offers.length > 1 ? "varias" : batch.assumption,
  );
  const [drafts, setDrafts] = useState<ExtractedOffer[]>(batch.offers);

  const visible = useMemo(
    () => (mode === "una" ? [collapseOffersToOne(drafts)] : drafts),
    [mode, drafts],
  );

  const setName = (index: number, name: string) => {
    setDrafts((rows) =>
      rows.map((row, i) => (i === index ? { ...row, productName: name } : row)),
    );
  };

  const removeAt = (index: number) => {
    setDrafts((rows) => rows.filter((_, i) => i !== index));
    if (drafts.length <= 2) setMode("una");
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
          Confirma
        </p>
        <h2 className="text-xl font-light mt-1">
          {visible.length > 1
            ? `Encontré ${visible.length} ofertas`
            : "Encontré una oferta"}
        </h2>
        <p className="text-sm text-fg3 mt-1">
          Revisa los nombres. Si son planes del mismo programa, elige una sola.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "una" ? "primary" : "outline"}
          onClick={() => setMode("una")}
        >
          Una sola
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "varias" ? "primary" : "outline"}
          onClick={() => setMode("varias")}
          disabled={drafts.length < 2}
        >
          Varias
        </Button>
      </div>

      {batch.questions.length > 0 && (
        <ul className="text-sm text-fg2 space-y-1 list-disc pl-4">
          {batch.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      )}

      <div className="space-y-3">
        {visible.map((offer, index) => (
          <div
            key={`${offer.productName}-${index}`}
            className="rounded-xl border border-separator1 p-3 space-y-2"
          >
            <div className="space-y-1">
              <Label htmlFor={`extract-name-${index}`}>Nombre</Label>
              <Input
                id={`extract-name-${index}`}
                value={
                  mode === "una" ? visible[0].productName : drafts[index]?.productName || ""
                }
                onChange={(event) => {
                  if (mode === "una") setName(0, event.target.value);
                  else setName(index, event.target.value);
                }}
              />
            </div>
            <p className="text-xs text-fg3">
              {commercialRecap(offer.commercial) || offer.productDescription.slice(0, 180)}
            </p>
            {mode === "varias" && drafts.length > 1 && (
              <button
                type="button"
                className="text-xs text-fg3 underline"
                onClick={() => removeAt(index)}
              >
                Quitar esta
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={saving || !visible.some((row) => row.productName.trim())}
          onClick={() => {
            const next =
              mode === "una"
                ? [{ ...collapseOffersToOne(drafts), productName: visible[0].productName.trim() || drafts[0].productName }]
                : drafts.filter((row) => row.productName.trim());
            onConfirm(next);
          }}
        >
          {saving ? "Guardando…" : "Así está, guardar"}
        </Button>
        {onBack && (
          <Button type="button" variant="outline" disabled={saving} onClick={onBack}>
            Volver a extraer
          </Button>
        )}
      </div>
    </div>
  );
}
