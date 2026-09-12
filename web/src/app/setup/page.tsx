"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AuthMenu } from "@/components/auth-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Upload } from "lucide-react";

type OfferRow = {
  id: string;
  productName: string;
  productDescription: string;
  pitchSummary: string;
  includeFathom: boolean;
};

type WorkspacePayload = {
  offers: OfferRow[];
  offer: OfferRow | null;
  transcripts: { id: string; title: string; source: string }[];
  fathomCount: number;
  transcriptCount: number;
  ready: boolean;
  canPractice?: boolean;
  playbookReady: boolean;
};

export default function SetupPage() {
  const { status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [savingOffer, setSavingOffer] = useState(false);
  const [savingTranscripts, setSavingTranscripts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [pitchSummary, setPitchSummary] = useState("");
  const [includeFathom, setIncludeFathom] = useState(false);
  const [paste, setPaste] = useState("");
  const [parsingDoc, setParsingDoc] = useState(false);

  const fillOffer = (offer: OfferRow | null) => {
    setOfferId(offer?.id || null);
    setProductName(offer?.productName || "");
    setProductDescription(offer?.productDescription || "");
    setPitchSummary(offer?.pitchSummary || "");
    setIncludeFathom(Boolean(offer?.includeFathom));
  };

  const load = async (nextOfferId?: string | null) => {
    const query = nextOfferId ? `?offerId=${encodeURIComponent(nextOfferId)}` : "";
    const response = await fetch(`/api/workspace${query}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Error");
    setWorkspace(data);
    if (nextOfferId === null) {
      fillOffer(null);
      return;
    }
    fillOffer(data.offer);
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login?mode=register&callbackUrl=/setup");
      return;
    }
    if (status !== "authenticated") return;
    load()
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [status, router]);

  const onSaveOffer = async (event: FormEvent) => {
    event.preventDefault();
    setSavingOffer(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: offerId,
          productName,
          productDescription,
          pitchSummary,
          includeFathom,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se guardó");
      await load(data.offer?.id || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSavingOffer(false);
    }
  };

  const uploadTranscripts = async (files?: FileList | null) => {
    if (!offerId) {
      setError("Guarda la oferta primero para colgarle las llamadas.");
      return;
    }
    setSavingTranscripts(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("offerId", offerId);
      if (files) {
        Array.from(files).forEach((file) => body.append("files", file));
      }
      if (paste.trim()) body.append("paste", paste.trim());
      const response = await fetch("/api/workspace/transcripts", {
        method: "POST",
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se subieron");
      setPaste("");
      await load(offerId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSavingTranscripts(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-bg0 flex items-center justify-center text-sm text-fg3">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Cargando tu espacio…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg0 flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 md:px-8 py-4 border-b border-separator1">
        <Link href="/" className="text-lg font-light">
          Closer Trainer
        </Link>
        <AuthMenu />
      </header>
      <main className="flex-1 max-w-2xl w-full mx-auto p-4 md:p-8 space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-light">Arma tu entrenamiento</h1>
          <p className="text-sm text-fg3">
            Puedes tener varias ofertas. Cada una guarda sus llamadas y el bot
            emula a esos leads.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(workspace?.offers || []).map((row) => (
            <Button
              key={row.id}
              type="button"
              size="sm"
              variant={row.id === offerId ? "primary" : "outline"}
              onClick={() => void load(row.id)}
            >
              {row.productName}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fillOffer(null)}
          >
            <Plus className="h-3.5 w-3.5" />
            Nueva oferta
          </Button>
        </div>

        <form
          onSubmit={onSaveOffer}
          className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4"
        >
          <h2 className="text-lg font-light">
            {offerId ? "Editar oferta" : "1. Nueva oferta"}
          </h2>
          <div className="space-y-1">
            <Label htmlFor="offer-name">Nombre</Label>
            <Input
              id="offer-name"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="Ej: Mentoría Scale Pro"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="offer-desc">Qué vendes, a quién, ticket, resultado</Label>
            <Textarea
              id="offer-desc"
              rows={6}
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              placeholder="ICP, promesa, planes, precios, objeciones típicas…"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="offer-pitch">Resumen de pitch (opcional)</Label>
            <Textarea
              id="offer-pitch"
              rows={3}
              value={pitchSummary}
              onChange={(e) => setPitchSummary(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2 text-sm text-fg2">
            <input
              type="checkbox"
              className="mt-1"
              checked={includeFathom}
              onChange={(e) => setIncludeFathom(e.target.checked)}
            />
            Usar mis llamadas de Fathom en esta oferta
          </label>
          <label className="flex items-center gap-2 text-xs text-fg2 cursor-pointer">
            <Upload className="h-3.5 w-3.5" />
            {parsingDoc ? "Leyendo one-pager…" : "O extrae la oferta de un PDF/TXT"}
            <input
              type="file"
              className="hidden"
              accept=".pdf,.txt,.md,application/pdf,text/plain"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setParsingDoc(true);
                setError(null);
                try {
                  const body = new FormData();
                  body.append("file", file);
                  const response = await fetch("/api/offer-from-doc", {
                    method: "POST",
                    body,
                  });
                  const data = await response.json();
                  if (!response.ok) throw new Error(data.error || "No se pudo leer");
                  setProductName(data.productName || "");
                  setProductDescription(data.productDescription || "");
                  setPitchSummary(data.pitchSummary || "");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Error");
                } finally {
                  setParsingDoc(false);
                }
              }}
            />
          </label>
          <Button type="submit" variant="primary" disabled={savingOffer}>
            {savingOffer ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : offerId ? (
              "Guardar cambios"
            ) : (
              "Crear oferta"
            )}
          </Button>
        </form>

        <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4">
          <h2 className="text-lg font-light">2. Llamadas de esta oferta</h2>
          <p className="text-sm text-fg3">
            Sube o pega transcripts de esta oferta. El bot emula a esos leads,
            no a los de otra oferta.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/fathom">Conectar / sync Fathom</Link>
            </Button>
            <label className="inline-flex">
              <Button type="button" variant="outline" size="sm" asChild>
                <span>
                  <Upload className="h-4 w-4" />
                  Subir transcripciones
                </span>
              </Button>
              <input
                type="file"
                className="hidden"
                multiple
                accept=".txt,.md,.vtt,.srt,.pdf,.csv,text/plain,application/pdf"
                onChange={(event) => {
                  void uploadTranscripts(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="space-y-1">
            <Label htmlFor="paste-calls">O pega una transcripción</Label>
            <Textarea
              id="paste-calls"
              rows={6}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Closer: …&#10;Lead: …"
            />
          </div>
          <Button
            type="button"
            variant="primary"
            disabled={savingTranscripts || !paste.trim() || !offerId}
            onClick={() => void uploadTranscripts()}
          >
            {savingTranscripts ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Procesando…
              </>
            ) : (
              "Guardar transcripción pegada"
            )}
          </Button>
          <p className="text-xs text-fg3">
            {workspace?.transcriptCount || 0} llamadas en esta oferta
            {includeFathom && workspace?.fathomCount
              ? ` (incluye ${workspace.fathomCount} de Fathom)`
              : ""}
            {workspace?.playbookReady ? " · playbook listo" : ""}
          </p>
          {workspace && workspace.transcripts.length > 0 && (
            <ul className="text-xs text-fg2 space-y-1 max-h-40 overflow-y-auto">
              {workspace.transcripts.map((row) => (
                <li key={row.id}>{row.title}</li>
              ))}
            </ul>
          )}
        </div>

        {(workspace?.ready || workspace?.canPractice) && (
          <Button asChild variant="primary" className="w-full">
            <Link href="/practicar">Ir a practicar</Link>
          </Button>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </main>
    </div>
  );
}
