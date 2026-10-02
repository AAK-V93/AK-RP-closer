"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BibliotecaPackList } from "@/app/biblioteca/pack-list";
import {
  normalizeLibraryPayload,
  type LibraryOffer,
  type LibraryPack,
} from "@/lib/library-pack";

export default function BibliotecaPage() {
  const { status } = useSession();
  const [packs, setPacks] = useState<LibraryPack[]>([]);
  const [offers, setOffers] = useState<LibraryOffer[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recientes" | "estrellas" | "puntaje">("puntaje");
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
    const library = normalizeLibraryPayload(data);
    setPacks(library.packs);
    setOffers(library.offers);
  };

  useEffect(() => {
    if (status !== "authenticated") return;
    load().catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [status]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (packs ?? []).filter((pack) => {
      if (!q) return true;
      const tags = pack.tags ?? [];
      return (
        (pack.title ?? "").toLowerCase().includes(q) ||
        (pack.publisher ?? "").toLowerCase().includes(q) ||
        tags.some((tag) => tag.toLowerCase().includes(q)) ||
        (pack.description ?? "").toLowerCase().includes(q)
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
                    {key === "puntaje" ? "Puntuación" : key === "estrellas" ? "Estrellas" : "Recientes"}
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

            <BibliotecaPackList
              packs={filtered}
              offers={offers ?? []}
              onPost={async (body) => {
                try {
                  await post(body);
                  if (body.action === "install") {
                    setNotice("Instalado. El CRM usará estos guiones en esa oferta.");
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Error");
                }
              }}
            />
          </>
        )}

        {notice && <p className="text-sm text-fg2">{notice}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </AppShell>
  );
}
