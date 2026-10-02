"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import {
  LIBRARY_EMPTY,
  LIBRARY_NEED_OFFER,
  libraryRateLabel,
  libraryScriptLine,
  libraryUsageLine,
} from "@/lib/library-copy";
import {
  normalizeLibraryOffers,
  normalizeLibraryPack,
  type LibraryOffer,
  type LibraryPack,
} from "@/lib/library-pack";

export function BibliotecaPackList({
  packs,
  offers,
  onPost,
  initialOpenId = null,
}: {
  packs: LibraryPack[];
  offers: LibraryOffer[];
  onPost: (body: Record<string, unknown>) => Promise<unknown>;
  initialOpenId?: string | null;
}) {
  const rows = (packs ?? [])
    .map((pack, index) => normalizeLibraryPack(pack, index))
    .filter((pack): pack is LibraryPack => pack !== null);
  const offerRows = normalizeLibraryOffers(offers);
  const [openId, setOpenId] = React.useState<string | null>(initialOpenId);
  const [installOffer, setInstallOffer] = React.useState<Record<string, string>>({});

  if (rows.length === 0) {
    return (
      <p className="text-sm text-fg3">{LIBRARY_EMPTY}</p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((pack) => {
        const tags = pack.tags ?? [];
        const items = pack.items ?? [];
        const offerId = installOffer[pack.id] || offerRows[0]?.id || "";
        const open = openId === pack.id;
        return (
          <div
            key={pack.id}
            className="rounded-2xl border border-separator1 bg-bg1 p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                className="text-left space-y-1 min-w-0"
                onClick={() => setOpenId(open ? null : pack.id)}
              >
                <p className="text-sm font-medium">{pack.title}</p>
                <p className="text-xs text-fg3">
                  {libraryUsageLine({
                    publisher: pack.publisher,
                    mine: pack.mine,
                    scripts: pack.scripts,
                    uses: pack.uses,
                  })}
                </p>
              </button>
              {pack.builtin ? null : (
                <Button
                  size="sm"
                  variant={pack.starred ? "primary" : "outline"}
                  aria-label={pack.starred ? "Quitar de favoritos" : "Guardar en favoritos"}
                  onClick={() =>
                    void onPost({ action: "star", packId: pack.id }).catch(() => undefined)
                  }
                >
                  <Star className={`h-3.5 w-3.5 ${pack.starred ? "fill-current" : ""}`} />
                  {pack.starred ? "Guardado" : "Guardar"}
                  {pack.stars > 0 ? ` · ${pack.stars}` : ""}
                </Button>
              )}
            </div>
            {pack.description && <p className="text-sm text-fg2">{pack.description}</p>}
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-separator1 px-2 py-0.5 text-[11px] text-fg3"
                >
                  {tag}
                </span>
              ))}
              {pack.puntaje > 0 && (
                <span className="rounded-full bg-bg2 px-2 py-0.5 text-[11px] text-fg2">
                  resultado {pack.puntaje}
                </span>
              )}
              {pack.uses > 0 && (
                <>
                  <span className="rounded-full bg-bg2 px-2 py-0.5 text-[11px] text-fg2">
                    {libraryRateLabel("enviados", pack.tasaEnvio)}
                  </span>
                  <span className="rounded-full bg-bg2 px-2 py-0.5 text-[11px] text-fg2">
                    {libraryRateLabel("cierres", pack.tasaCierre)}
                  </span>
                </>
              )}
            </div>
            {open && (
              <div className="space-y-3 border-t border-separator1 pt-3">
                {items.map((item) => (
                  <div key={item.id} className="space-y-1">
                    <p className="text-xs text-fg3">
                      {libraryScriptLine({
                        type: item.type,
                        canal: item.canal,
                        puntaje: item.puntaje,
                        uses: item.uses,
                      })}
                    </p>
                    {item.recomendacion && (
                      <p className="text-[11px] text-fg3">{item.recomendacion}</p>
                    )}
                    <p className="text-xs text-fg2 whitespace-pre-wrap">{item.guion}</p>
                    {item.asset ? (
                      <p className="text-[11px] text-fg3 break-all">{item.asset}</p>
                    ) : null}
                  </div>
                ))}
                {offerRows.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-md border border-separator1 bg-bg0 px-2 py-1 text-xs"
                      value={offerId}
                      onChange={(event) =>
                        setInstallOffer((prev) => ({
                          ...prev,
                          [pack.id]: event.target.value,
                        }))
                      }
                    >
                      {(offerRows ?? []).map((offer) => (
                        <option key={offer.id} value={offer.id}>
                          Usar en {offer.productName}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!offerId}
                      onClick={() =>
                        void onPost({
                          action: "install",
                          packId: pack.id,
                          offerId,
                        })
                      }
                    >
                      Usar estos guiones
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-fg3">{LIBRARY_NEED_OFFER}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
