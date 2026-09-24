"use client";

import { FormEvent, useEffect, useState, type InputHTMLAttributes } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Upload } from "lucide-react";
import { parseFollowupScripts } from "@/lib/followup-scripts";
import {
  commercialRecap,
  offerToSavePayload,
  parseCommercial,
  type ExtractedOffer,
} from "@/lib/offer-commercial";
import { OfferExtractReview } from "@/components/offer-extract-review";
import { partitionTranscriptUploads } from "@/lib/transcript-batch";

type OfferRow = {
  id: string;
  productName: string;
  productDescription: string;
  pitchSummary: string;
  includeFathom: boolean;
  readyCrm?: boolean;
  commercial?: Record<string, unknown>;
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
  readyCrm?: boolean;
};

export default function OfertasPage() {
  const { status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [savingOffer, setSavingOffer] = useState(false);
  const [savingTranscripts, setSavingTranscripts] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [pitchSummary, setPitchSummary] = useState("");
  const [includeFathom, setIncludeFathom] = useState(false);
  const [commercial, setCommercial] = useState<Record<string, unknown> | null>(null);
  const [paste, setPaste] = useState("");
  const [offerBlob, setOfferBlob] = useState("");
  const [parsingDoc, setParsingDoc] = useState(false);
  const [publishingPack, setPublishingPack] = useState(false);
  const [review, setReview] = useState<{
    assumption: "una" | "varias";
    questions: string[];
    offers: ExtractedOffer[];
  } | null>(null);

  const fillOffer = (offer: OfferRow | null) => {
    setOfferId(offer?.id || null);
    setProductName(offer?.productName || "");
    setProductDescription(offer?.productDescription || "");
    setPitchSummary(offer?.pitchSummary || "");
    setIncludeFathom(Boolean(offer?.includeFathom));
    setCommercial(offer?.commercial || null);
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
      router.replace("/login?mode=register&callbackUrl=/ofertas");
      return;
    }
    if (status !== "authenticated") return;
    load()
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [status, router]);

  const extractOffer = async (files?: FileList | null, blob = offerBlob) => {
    if (!files?.length && blob.trim().length < 40) {
      setError("Pega un texto o sube un documento.");
      return;
    }
    setParsingDoc(true);
    setError(null);
    try {
      const body = new FormData();
      if (files) Array.from(files).forEach((file) => body.append("files", file));
      if (blob.trim()) body.set("paste", blob.trim());
      const response = await fetch("/api/offer-from-doc", {
        method: "POST",
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo leer");
      const offers = (data.offers || []).length
        ? data.offers
        : data.productName
          ? [
              {
                productName: data.productName,
                productDescription: data.productDescription,
                pitchSummary: data.pitchSummary || "",
                icp: data.icp || "",
                commercial: data.commercial,
              },
            ]
          : [];
      if (!offers.length) throw new Error("No encontré una oferta en ese texto");
      setReview({
        assumption: data.assumption === "varias" || offers.length > 1 ? "varias" : "una",
        questions: Array.isArray(data.questions) ? data.questions : [],
        offers,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setParsingDoc(false);
    }
  };

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
          commercial,
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

  const confirmExtracted = async (offers: ExtractedOffer[]) => {
    setSavingOffer(true);
    setError(null);
    try {
      let lastId = offerId;
      for (let index = 0; index < offers.length; index += 1) {
        const payload = offerToSavePayload(offers[index]);
        const response = await fetch("/api/workspace/offer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: index === 0 ? offerId : undefined,
            ...payload,
            includeFathom: index === 0 ? includeFathom : false,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se guardó");
        lastId = data.offer?.id || lastId;
      }
      setReview(null);
      setOfferBlob("");
      await load(lastId || null);
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
    setUploadNote(null);
    try {
      if (files && files.length > 0) {
        const split = partitionTranscriptUploads(Array.from(files));
        if (split.accepted.length === 0) {
          throw new Error(
            split.ignored > 0
              ? "En esa carpeta no hay transcripciones (.txt, .vtt, .srt, .md, .csv, .pdf)."
              : "Esos archivos pasan de 6 MB.",
          );
        }
        const toFile: string[] = [];
        let saved = 0;
        let already = 0;
        for (let index = 0; index < split.chunks.length; index += 1) {
          setUploadNote(`Guardando ${index + 1} de ${split.chunks.length}…`);
          const body = new FormData();
          body.append("offerId", offerId);
          body.append("batch", "1");
          for (const file of split.chunks[index]) body.append("files", file);
          const response = await fetch("/api/workspace/transcripts", { method: "POST", body });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "No se subieron");
          saved += data.saved || 0;
          already += data.already || 0;
          if (Array.isArray(data.toFile)) toFile.push(...data.toFile);
        }
        let filed = 0;
        let failed = 0;
        for (let index = 0; index < toFile.length; index += 1) {
          setUploadNote(`Pasando al CRM ${index + 1} de ${toFile.length}…`);
          const response = await fetch("/api/workspace/transcripts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ offerId, fileId: toFile[index] }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) failed += 1;
          else if (data.filed) filed += 1;
        }
        await fetch("/api/workspace/transcripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offerId, finalize: true }),
        });
        const ignored = split.ignored ? ` Ignoré ${split.ignored} que no son transcripción.` : "";
        const missed = failed ? ` ${failed} no entraron al CRM; vuelve a elegir la carpeta para reintentarlas.` : "";
        setUploadNote(
          `Listo: ${saved} nuevas, ${filed} al CRM, ${already} ya estaban.${ignored}${missed} Las que falte un dato quedan en Inicio.`,
        );
      } else if (paste.trim()) {
        const body = new FormData();
        body.append("offerId", offerId);
        body.append("paste", paste.trim());
        const response = await fetch("/api/workspace/transcripts", { method: "POST", body });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se subieron");
        setPaste("");
      }
      await load(offerId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSavingTranscripts(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <AppShell>
        <p className="text-sm text-fg3 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando tu espacio…
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-light">Ofertas</h1>
          <p className="text-sm text-fg3">
            Sube el documento o pega un solo texto. Extraemos precios, pagos y
            cómo te pagan comisión (aunque dependa del plazo o la forma de pago).
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
              {row.readyCrm ? "" : " ·"}
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

        <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4">
          <h2 className="text-lg font-light">
            {offerId ? "Actualizar desde documento o texto" : "1. Documento o un texto"}
          </h2>
          <p className="text-sm text-fg3">
            No hace falta ir campo por campo. Si tu comisión cambia según
            cuándo y cómo pague el lead, escríbelo así.
          </p>
          <label className="flex items-center gap-2 text-xs text-fg2 cursor-pointer">
            <Upload className="h-3.5 w-3.5" />
            {parsingDoc ? "Extrayendo…" : "Subir PDF, TXT o imagen"}
            <input
              type="file"
              className="hidden"
              multiple
              accept=".pdf,.txt,.md,.png,.jpg,.jpeg,application/pdf,text/plain,image/*"
              onChange={(event) => {
                void extractOffer(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <div className="space-y-1">
            <Label htmlFor="offer-blob">O pega todo aquí</Label>
            <Textarea
              id="offer-blob"
              rows={8}
              value={offerBlob}
              onChange={(e) => setOfferBlob(e.target.value)}
              placeholder="Programa, ticket, formas de pago, plazos, y cómo te pagan comisión según cuándo y cómo pague el lead…"
            />
          </div>
          <Button
            type="button"
            variant="primary"
            disabled={parsingDoc || offerBlob.trim().length < 40}
            onClick={() => void extractOffer(null, offerBlob)}
          >
            {parsingDoc ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Extrayendo…
              </>
            ) : (
              "Extraer de este texto"
            )}
          </Button>
          {review && (
            <OfferExtractReview
              batch={review}
              saving={savingOffer}
              onBack={() => setReview(null)}
              onConfirm={(offers) => void confirmExtracted(offers)}
            />
          )}
          {!review && commercial && (
            <p className="text-xs text-fg2 rounded-xl border border-separator1 px-3 py-2">
              {commercialRecap(parseCommercial(commercial)) ||
                "Extraído. Revisa nombre y descripción abajo y guarda."}
            </p>
          )}
        </div>

        <form
          onSubmit={onSaveOffer}
          className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4"
        >
          <h2 className="text-lg font-light">
            {offerId ? "Ajustar si hace falta" : "Revisa y guarda"}
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

        {offerId &&
          parseFollowupScripts(
            (commercial as { scripts?: unknown } | null)?.scripts,
          ).length > 0 && (
            <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-3">
              <h2 className="text-lg font-light">Publicar en la biblioteca</h2>
              <p className="text-sm text-fg3">
                Sube los guiones de esta oferta como un pack público. Quedas
                tagged como publisher; el puntaje sale de si otros (y tú) los
                envían, cierran o pierden.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="primary"
                  disabled={publishingPack}
                  onClick={async () => {
                    setPublishingPack(true);
                    setError(null);
                    try {
                      const response = await fetch("/api/biblioteca", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "publish-offer",
                          offerId,
                          title: `Seguimientos · ${productName}`,
                          tags: productName,
                        }),
                      });
                      const data = await response.json();
                      if (!response.ok) throw new Error(data.error || "No se publicó");
                      router.push("/biblioteca");
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Error");
                    } finally {
                      setPublishingPack(false);
                    }
                  }}
                >
                  {publishingPack ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Publicando…
                    </>
                  ) : (
                    `Publicar ${parseFollowupScripts((commercial as { scripts?: unknown } | null)?.scripts).length} guiones`
                  )}
                </Button>
                <Button asChild variant="outline">
                  <Link href="/biblioteca">Ver biblioteca</Link>
                </Button>
              </div>
            </div>
          )}

        <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4">
          <h2 className="text-lg font-light">2. Llamadas de esta oferta</h2>
          <p className="text-sm text-fg3">
            Sube la carpeta de transcripciones de esta oferta (.txt, .vtt, .srt, .md, .csv, .pdf).
            El video no entra. No hay tope de archivos: se mandan todas y cada una pasa al CRM.
            Deja esta pestaña abierta hasta que diga listo.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/llamadas#conectar-fathom">Conectar / sync Fathom</Link>
            </Button>
            <label className="inline-flex">
              <Button type="button" variant="outline" size="sm" asChild disabled={savingTranscripts}>
                <span>
                  <Upload className="h-4 w-4" />
                  Subir carpeta
                </span>
              </Button>
              <input
                type="file"
                className="hidden"
                disabled={savingTranscripts}
                {...({
                  webkitdirectory: "",
                  directory: "",
                  multiple: true,
                } as InputHTMLAttributes<HTMLInputElement>)}
                onChange={(event) => {
                  void uploadTranscripts(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            <label className="inline-flex">
              <Button type="button" variant="outline" size="sm" asChild disabled={savingTranscripts}>
                <span>Elegir archivos</span>
              </Button>
              <input
                type="file"
                className="hidden"
                multiple
                disabled={savingTranscripts}
                accept=".txt,.md,.vtt,.srt,.pdf,.csv,text/plain,application/pdf"
                onChange={(event) => {
                  void uploadTranscripts(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {uploadNote && <p className="text-sm text-fg2">{uploadNote}</p>}
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
            {workspace?.offers.find((r) => r.id === offerId)?.readyCrm ||
            workspace?.readyCrm
              ? " · CRM listo"
              : " · falta precio, pagos o cómo te pagan comisión (pega un texto o sube el doc)"}
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
      </div>
    </AppShell>
  );
}
