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
import { TIPOS_SEGUIMIENTO } from "@/lib/crm-catalog";
import {
  LIBRARY_INSTALLED,
  LIBRARY_INTRO,
  LIBRARY_PUBLISH_HELP,
  LIBRARY_PUBLISH_TITLE,
  LIBRARY_PUBLISHED,
  LIBRARY_SEARCH,
  libraryKindLabel,
  librarySituationOptions,
  librarySortLabel,
  packMatchesSituation,
} from "@/lib/library-copy";
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
  const [situation, setSituation] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
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
    load().catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la biblioteca"));
  }, [status]);

  const situations = useMemo(() => librarySituationOptions(packs), [packs]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (packs ?? []).filter((pack) => {
      if (situation && !packMatchesSituation(pack, situation)) return false;
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
  }, [packs, query, situation, sort]);

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
      setNotice(LIBRARY_PUBLISHED);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo publicar");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-[-0.01em] text-fg0 md:text-[40px]">
            Biblioteca
          </h1>
          <p className="text-sm text-fg3">{LIBRARY_INTRO}</p>
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
                placeholder={LIBRARY_SEARCH}
              />
              <div className="flex gap-1">
                {(["puntaje", "estrellas", "recientes"] as const).map((key) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={sort === key ? "primary" : "outline"}
                    onClick={() => setSort(key)}
                  >
                    {librarySortLabel(key)}
                  </Button>
                ))}
              </div>
            </div>

            {situations.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Situación">
                <button
                  type="button"
                  aria-pressed={!situation}
                  onClick={() => setSituation("")}
                  className={`inline-flex h-11 min-h-11 items-center rounded-full px-3.5 text-sm font-medium ${
                    !situation ? "bg-fg0 text-[#FBF8F2]" : "border border-separator2 bg-bg1 text-fg0"
                  }`}
                >
                  Todas
                </button>
                {situations.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={situation === item.id}
                    onClick={() => setSituation(situation === item.id ? "" : item.id)}
                    className={`inline-flex h-11 min-h-11 items-center rounded-full px-3.5 text-sm font-medium ${
                      situation === item.id ? "bg-fg0 text-[#FBF8F2]" : "border border-separator2 bg-bg1 text-fg0"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            {situation && filtered.length === 0 && packs.length > 0 ? (
              <p className="text-sm text-fg3">Ningún guion para esa situación.</p>
            ) : (
            <BibliotecaPackList
              packs={filtered}
              offers={offers ?? []}
              onPost={async (body) => {
                try {
                  await post(body);
                  if (body.action === "install") {
                    setNotice(LIBRARY_INSTALLED);
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : "No se pudo");
                }
              }}
            />
            )}

            <div className="space-y-3">
              <Button type="button" variant={publishOpen ? "outline" : "primary"} onClick={() => setPublishOpen((open) => !open)}>
                {publishOpen ? "Ocultar formulario" : LIBRARY_PUBLISH_TITLE}
              </Button>
            {publishOpen && (
            <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-3">
              <h2 className="font-display text-[22px] font-semibold text-fg0">{LIBRARY_PUBLISH_TITLE}</h2>
              <p className="text-xs text-fg3">
                {LIBRARY_PUBLISH_HELP}{" "}
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
                    placeholder="Retomar contacto"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pack-tags">Temas</Label>
                  <Input
                    id="pack-tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="cobro, primera respuesta"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pack-desc">Para qué sirve</Label>
                <Input
                  id="pack-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Cuando la persona no contesta"
                />
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="pack-type">Cuándo se usa</Label>
                  <select
                    id="pack-type"
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value)}
                    className="h-11 w-full rounded border border-separator2 bg-bg1 px-2 text-sm text-fg2"
                  >
                    {TIPOS_SEGUIMIENTO.map((kind) => (
                      <option key={kind} value={kind}>
                        {libraryKindLabel(kind)}
                      </option>
                    ))}
                  </select>
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
            )}
            </div>
          </>
        )}

        {notice && <p className="text-sm text-fg2">{notice}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </AppShell>
  );
}
