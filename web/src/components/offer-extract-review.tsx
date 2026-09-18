"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { collapseOffersToOne, type ExtractedOffer } from "@/lib/offer-commercial";
import {
  allOfferBlocksConfirmed,
  applyOfferBlockPatch,
  blockDraft,
  confirmKey,
  offerConfirmBlocks,
  OFFER_CONFIRM_BLOCKS,
  type OfferConfirmBlockId,
} from "@/lib/offer-confirm";

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
  const originals = batch.offers;
  const [mode, setMode] = useState<"una" | "varias">(
    batch.offers.length > 1 ? "varias" : batch.assumption,
  );
  const [drafts, setDrafts] = useState<ExtractedOffer[]>(
    batch.offers.length > 1 && batch.assumption === "una"
      ? [collapseOffersToOne(batch.offers)]
      : batch.offers,
  );
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{
    index: number;
    id: OfferConfirmBlockId;
    draft: string;
  } | null>(null);

  const visible = useMemo(
    () => (mode === "una" ? [collapseOffersToOne(drafts)] : drafts),
    [mode, drafts],
  );

  const ready = allOfferBlocksConfirmed(visible.length, confirmed);

  const switchMode = (next: "una" | "varias") => {
    setConfirmed({});
    setEditing(null);
    if (next === "una") setDrafts([collapseOffersToOne(originals)]);
    else setDrafts(originals.length > 1 ? originals : drafts);
    setMode(next);
  };

  const patchOffer = (
    index: number,
    fn: (offer: ExtractedOffer) => ExtractedOffer,
  ) => {
    if (mode === "una") {
      setDrafts([fn(visible[0])]);
      return;
    }
    setDrafts((rows) => rows.map((row, i) => (i === index ? fn(row) : row)));
  };

  const removeAt = (index: number) => {
    setDrafts((rows) => rows.filter((_, i) => i !== index));
    setConfirmed({});
    setEditing(null);
    if (drafts.length <= 2) setMode("una");
  };

  return (
    <div className="relative space-y-4" aria-busy={saving}>
      {saving && (
        <div
          className="sticky top-2 z-10 rounded-xl border border-primary/40 bg-bg1 px-3 py-3 flex items-center gap-3"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-5 w-5 animate-spin shrink-0" />
          <div>
            <p className="text-sm">Guardando tu oferta…</p>
            <p className="text-xs text-fg3">
              No cierres esta pantalla. Ya confirmaste los bloques; ahora los
              estamos guardando.
            </p>
          </div>
        </div>
      )}

      <div
        className={
          saving ? "pointer-events-none opacity-60 space-y-4" : "space-y-4"
        }
      >
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
          Cada bloque: Sí o Corregir. La comisión no la asumo.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "una" ? "primary" : "outline"}
          onClick={() => switchMode("una")}
          disabled={saving}
        >
          Una sola
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "varias" ? "primary" : "outline"}
          onClick={() => switchMode("varias")}
          disabled={saving || originals.length < 2}
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

      <div className="space-y-4">
        {visible.map((offer, index) => (
          <div
            key={`${offer.productName}-${index}`}
            className="rounded-xl border border-separator1 p-3 space-y-3"
          >
            {mode === "varias" && drafts.length > 1 && (
              <button
                type="button"
                className="text-xs text-fg3 underline"
                onClick={() => removeAt(index)}
              >
                Quitar esta
              </button>
            )}
            {offerConfirmBlocks(offer).map((block) => {
              const key = confirmKey(index, block.id);
              const isEditing =
                editing?.index === index && editing.id === block.id;
              const ok = Boolean(confirmed[key]);
              return (
                <div
                  key={block.id}
                  className={`rounded-lg border p-3 space-y-2 ${
                    ok ? "border-primary/40 bg-primary/5" : "border-separator1 bg-bg0"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
                      {block.title}
                      {ok ? " · listo" : ""}
                    </p>
                  </div>
                  {!isEditing && (
                    <p className="text-sm whitespace-pre-wrap">{block.summary}</p>
                  )}
                  {block.hint && !isEditing && !ok && (
                    <p className="text-[11px] text-fg3">{block.hint}</p>
                  )}
                  {isEditing ? (
                    <div className="space-y-2">
                      {block.id === "name" ? (
                        <Input
                          value={editing.draft}
                          onChange={(event) =>
                            setEditing({ ...editing, draft: event.target.value })
                          }
                        />
                      ) : (
                        <Textarea
                          rows={4}
                          value={editing.draft}
                          onChange={(event) =>
                            setEditing({ ...editing, draft: event.target.value })
                          }
                        />
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            patchOffer(index, (row) =>
                              applyOfferBlockPatch(row, block.id, editing.draft),
                            );
                            setConfirmed((prev) => ({ ...prev, [key]: true }));
                            setEditing(null);
                          }}
                        >
                          Listo
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(null)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={ok ? "primary" : "outline"}
                        onClick={() =>
                          setConfirmed((prev) => ({ ...prev, [key]: true }))
                        }
                      >
                        Sí
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditing({
                            index,
                            id: block.id,
                            draft: blockDraft(offer, block.id),
                          })
                        }
                      >
                        Corregir
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={saving || !ready || !visible.some((row) => row.productName.trim())}
          onClick={() => {
            const next =
              mode === "una"
                ? [
                    {
                      ...visible[0],
                      productName: visible[0].productName.trim() || drafts[0].productName,
                    },
                  ]
                : drafts.filter((row) => row.productName.trim());
            onConfirm(next);
          }}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Guardando tu oferta…
            </>
          ) : ready ? (
            "Así está, guardar"
          ) : (
            "Marca Sí o Corregir en cada bloque"
          )}
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

export { OFFER_CONFIRM_BLOCKS };
