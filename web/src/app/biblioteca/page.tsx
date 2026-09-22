"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";

type PackItem = {
  id: string;
  type: string;
  canal: string;
  recomendacion: string;
  guion: string;
  asset?: string;
  uses: number;
  puntaje: number;
  tasaCierre: number;
  tasaEnvio: number;
};

type Pack = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  publisher: string;
  mine: boolean;
  starred: boolean;
  stars: number;
  scripts: number;
  uses: number;
  puntaje: number;
  tasaCierre: number;
  tasaEnvio: number;
  items: PackItem[];
  builtin?: boolean;
};

type OfferOpt = { id: string; productName: string; scriptCount: number };

export default function BibliotecaPage() {
  const { status } = useSession();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [offers, setOffers] = useState<OfferOpt[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recientes" | "estrellas" | "puntaje">("puntaje");
  const [openId, setOpenId] = useState<string | null>(null);
  const [installOffer, setInstallOffer] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [guion, setGuion] = useState("");
  const [tipo, setTipo] = useState("RETOMAR");
  const [publishing, setPublishing] = useState(false);

  const load = async () => {
    const response = await fetch("/api/biblioteca");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Error");
    setPacks(data.packs || []);
    setOffers(data.offers || []);
  };

  useEffect(() => {
    if (status !== "authenticated") return;
    load().catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [status]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = packs.filter((pack) => {
      if (!q) return true;
      return (
        pack.title.toLowerCase().includes(q) ||
        pack.publisher.toLowerCase().includes(q) ||
        pack.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        pack.description.toLowerCase().includes(q)
      );
    });
    return rows.sort((a, b) => {
      if (sort === "estrellas") return b.stars - a.stars || b.puntaje - a.puntaje;
      if (sort === "puntaje") return b.puntaje - a.puntaje || b.stars - a.stars;
      return 0;
    });
  }, [packs, query, sort]);

  const post = async (body: Record<string, unknown>) => {
    setError(null);
    setNotice(null);
    const response = await fetch("/api/biblioteca", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo");
    await load();
    return data;
  };

  const onPublish = async () => {
    setPublishing(true);
    try {
      await post({
        action: "publish",
        title,
        description,
        tags,
        scripts: [{ type: tipo, guion, canal: "WHATSAPP" }],
      });
      setTitle("");
      setDescription("");
      setTags("");
      setGuion("");
      setNotice("Pack publicado. Otros closers ya pueden instalarlo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-light">Biblioteca</h1>
          <p className="text-sm text-fg3">
            Packs de seguimiento, como repos: quien los publica queda tagged,
            se estrellan y el puntaje sale de si se enviaron, cerraron o se
            perdieron. Instálalos en una oferta y el CRM usa esos guiones.
          </p>
        </div>

        {status !== "authenticated" ? (
          <Button asChild variant="primary">
            <Link href="/login?callbackUrl=/biblioteca">Entrar</Link>
          </Button>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar pack, @publisher o tag"
              />
              <div className="flex gap-1">
                {(["puntaje", "estrellas", "recientes"] as const).map((key) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={sort === key ? "primary" : "outline"}
                    onClick={() => setSort(key)}
                  >
                    {key === "puntaje" ? "Puntaje" : key === "estrellas" ? "Estrellas" : "Recientes"}
                  </Button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-3">
              <h2 className="text-lg font-light">Publicar un pack</h2>
              <p className="text-xs text-fg3">
                Un guion con variables tipo <code>[Nombre]</code> y{" "}
                <code>[PROGRAMA]</code>. O publica todos los de una oferta desde{" "}
                <Link href="/ofertas" className="underline">
                  Ofertas
                </Link>
                .
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="pack-title">Nombre</Label>
                  <Input
                    id="pack-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Retomar emocional · high ticket"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pack-tags">Tags</Label>
                  <Input
                    id="pack-tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="retomar, whatsapp, cobro"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pack-desc">Qué cubre</Label>
                <Input
                  id="pack-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Toques 1–3 cuando el lead no contesta"
                />
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="pack-type">Tipo</Label>
                  <Input
                    id="pack-type"
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value.toUpperCase())}
                    placeholder="RETOMAR"
                  />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <Label htmlFor="pack-guion">Guion</Label>
                  <Textarea
                    id="pack-guion"
                    rows={4}
                    value={guion}
                    onChange={(e) => setGuion(e.target.value)}
                    placeholder="Hola [Nombre], ¿seguimos con [PROGRAMA]?"
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={publishing || !title.trim() || !guion.trim()}
                onClick={() => void onPublish()}
              >
                {publishing ? "Publicando…" : "Publicar"}
              </Button>
            </div>

            {filtered.length === 0 ? (
              <p className="text-sm text-fg3">
                Todavía no hay packs públicos. Publica el primero.
              </p>
            ) : (
              <div className="space-y-3">
                {filtered.map((pack) => {
                  const offerId = installOffer[pack.id] || offers[0]?.id || "";
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
                            @{pack.publisher}
                            {pack.mine ? " · tuyo" : ""}
                            {" · "}
                            {pack.scripts} guion{pack.scripts === 1 ? "" : "es"}
                            {" · "}
                            {pack.uses} usos
                          </p>
                        </button>
                        {pack.builtin ? null : (
                          <Button
                            size="sm"
                            variant={pack.starred ? "primary" : "outline"}
                            onClick={() =>
                              void post({ action: "star", packId: pack.id }).catch((e) =>
                                setError(e instanceof Error ? e.message : "Error"),
                              )
                            }
                          >
                            <Star className={`h-3.5 w-3.5 ${pack.starred ? "fill-current" : ""}`} />
                            {pack.stars}
                          </Button>
                        )}
                      </div>
                      {pack.description && (
                        <p className="text-sm text-fg2">{pack.description}</p>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {pack.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-separator1 px-2 py-0.5 text-[11px] text-fg3"
                          >
                            {tag}
                          </span>
                        ))}
                        <span className="rounded-full bg-bg2 px-2 py-0.5 text-[11px] text-fg2">
                          puntaje {pack.puntaje}
                        </span>
                        <span className="rounded-full bg-bg2 px-2 py-0.5 text-[11px] text-fg2">
                          envío {Math.round(pack.tasaEnvio * 100)}%
                        </span>
                        <span className="rounded-full bg-bg2 px-2 py-0.5 text-[11px] text-fg2">
                          cierre {Math.round(pack.tasaCierre * 100)}%
                        </span>
                      </div>
                      {open && (
                        <div className="space-y-3 border-t border-separator1 pt-3">
                          {pack.items.map((item) => (
                            <div key={item.id} className="space-y-1">
                              <p className="text-xs text-fg3">
                                {item.type} · {item.canal} · puntaje {item.puntaje} ·{" "}
                                {item.uses} usos
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
                          {offers.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                className="rounded-md border border-separator1 bg-bg0 px-2 py-1 text-xs"
                                value={offerId}
                                onChange={(e) =>
                                  setInstallOffer((prev) => ({
                                    ...prev,
                                    [pack.id]: e.target.value,
                                  }))
                                }
                              >
                                {offers.map((offer) => (
                                  <option key={offer.id} value={offer.id}>
                                    Instalar en {offer.productName}
                                  </option>
                                ))}
                              </select>
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={!offerId}
                                onClick={() =>
                                  void post({
                                    action: "install",
                                    packId: pack.id,
                                    offerId,
                                  })
                                    .then(() =>
                                      setNotice(
                                        "Instalado. El CRM usará estos guiones en esa oferta.",
                                      ),
                                    )
                                    .catch((e) =>
                                      setError(e instanceof Error ? e.message : "Error"),
                                    )
                                }
                              >
                                Instalar
                              </Button>
                            </div>
                          ) : (
                            <p className="text-xs text-fg3">
                              Crea una oferta para instalar este pack.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {notice && <p className="text-sm text-fg2">{notice}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </AppShell>
  );
}
