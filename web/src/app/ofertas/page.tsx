"use client";

import { FormEvent, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Upload } from "lucide-react";
import { parseFollowupScripts } from "@/lib/followup-scripts";
import {
  filterPersistableOffers,
  isCompleteOfferSave,
  offerSavedLabel,
  offerSaveFailureMessage,
  postWorkspaceOffer,
} from "@/lib/offer-save";
import {
  commissionSummary,
  crmGaps,
  missingOfferSetupPhrase,
  offerToSavePayload,
  parseCommercial,
  savedBonusNames,
  type ExtractedOffer,
} from "@/lib/offer-commercial";
import { libraryKindLabel } from "@/lib/library-copy";
import { offerSwitchLabel, practiceOfferGlance } from "@/lib/practice-offer-glance";
import { WorkspaceSkeleton } from "@/components/page-skeleton";
import { OfferExtractReview } from "@/components/offer-extract-review";
import { OFFER_EXTRACT_PROGRESS, runOfferExtraction } from "@/lib/offer-upload";
import { partitionTranscriptUploads } from "@/lib/transcript-batch";
import { countPhrase } from "@/lib/plain-labels";
import { pickWorkspaceOffer } from "@/lib/offer-selection";

function offerSetupNote(offer?: {
  productName?: string;
  commercial?: unknown;
  readyCrm?: boolean;
}) {
  if (!offer) return "";
  if (offer.readyCrm) return " · CRM listo";
  const missing = missingOfferSetupPhrase(crmGaps(offer));
  return missing ? ` · ${missing} (pega un texto o sube el doc)` : "";
}

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
  const searchParams = useSearchParams();
  const offerFromUrl = searchParams.get("offerId");
  const loadSeq = useRef(0);
  const [loading, setLoading] = useState(true);
  const [savingOffer, setSavingOffer] = useState(false);
  const [savingTranscripts, setSavingTranscripts] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
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
  const [extractProgress, setExtractProgress] = useState(OFFER_EXTRACT_PROGRESS);
  const [canRetryExtract, setCanRetryExtract] = useState(false);
  const [lastExtractFiles, setLastExtractFiles] = useState<File[] | null>(null);
  const extractGen = useRef(0);
  const [publishingPack, setPublishingPack] = useState(false);
  const [review, setReview] = useState<{
    assumption: "una" | "varias";
    questions: string[];
    offers: ExtractedOffer[];
  } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement | null>(null);

  const fillOffer = (offer: OfferRow | null) => {
    setOfferId(offer?.id || null);
    setProductName(offer?.productName || "");
    setProductDescription(offer?.productDescription || "");
    setPitchSummary(offer?.pitchSummary || "");
    setIncludeFathom(Boolean(offer?.includeFathom));
    setCommercial(offer?.commercial || null);
    setScriptsOpen(false);
  };

  const load = async (nextOfferId?: string | null) => {
    const seq = ++loadSeq.current;
    const explicitNew = nextOfferId === "";
    const id = explicitNew ? "" : String(nextOfferId || "").trim();
    const query = id ? `?offerId=${encodeURIComponent(id)}` : "";
    const response = await fetch(`/api/workspace${query}`, { cache: "no-store" });
    const data = await response.json();
    if (seq !== loadSeq.current) return;
    if (!response.ok) throw new Error(data.error || "Error");
    const offers = Array.isArray(data.offers) ? data.offers : [];
    setWorkspace({
      ...data,
      offers,
      transcripts: Array.isArray(data.transcripts) ? data.transcripts : [],
    });
    if (explicitNew) {
      fillOffer(null);
      return;
    }
    const shown = id
      ? pickWorkspaceOffer(offers, id) || (data.offer?.id === id ? data.offer : null)
      : pickWorkspaceOffer(offers, null);
    if (shown) fillOffer(shown);
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login?mode=register&callbackUrl=/ofertas");
      return;
    }
    if (status !== "authenticated") return;
    load(offerFromUrl)
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [status, offerFromUrl]);

  const showOffer = (id: string | null) => {
    const offers = Array.isArray(workspace?.offers) ? workspace.offers : [];
    if (id) {
      const row = pickWorkspaceOffer(offers, id);
      if (row) fillOffer(row);
      setComposerOpen(false);
    } else {
      fillOffer(null);
      setComposerOpen(true);
    }
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("offerId", id);
    else params.set("offerId", "");
    const query = params.toString();
    router.replace(query ? `/ofertas?${query}` : "/ofertas", { scroll: false });
  };

  const openComposer = () => {
    setComposerOpen(true);
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ block: "nearest" });
    });
  };

  const extractOffer = async (files?: FileList | File[] | null, blob = offerBlob) => {
    const list = files === undefined ? lastExtractFiles : files ? Array.from(files) : [];
    if (!list?.length && blob.trim().length < 40) {
      setError("Pega un texto o sube un documento.");
      setCanRetryExtract(false);
      return;
    }
    const gen = ++extractGen.current;
    setParsingDoc(true);
    setError(null);
    setCanRetryExtract(false);
    if (list?.length) setLastExtractFiles(list);
    try {
      const data = await runOfferExtraction({
        files: list || [],
        paste: blob,
        onProgress: (message) => {
          if (gen === extractGen.current) setExtractProgress(message);
        },
      });
      if (gen !== extractGen.current) return;
      setReview(data);
    } catch (e) {
      if (gen !== extractGen.current) return;
      setCanRetryExtract(true);
      setError(e instanceof Error ? e.message : "No pude leer ese documento. Pulsa Reintentar.");
    } finally {
      if (gen === extractGen.current) setParsingDoc(false);
    }
  };

  const onSaveOffer = async (event: FormEvent) => {
    event.preventDefault();
    // Upload already started extraction. Saving the form underneath would POST
    // the previous (sometimes empty) fields and the route answers 400.
    if (review || parsingDoc) return;
    if (!isCompleteOfferSave({ productName, productDescription })) {
      setError("Nombre y descripción de la oferta son obligatorios");
      return;
    }
    setSavingOffer(true);
    setError(null);
    setSavedNote(null);
    try {
      const saved = await postWorkspaceOffer({
        id: offerId,
        productName,
        productDescription,
        pitchSummary,
        includeFathom,
        commercial,
      });
      setSavedNote(offerSavedLabel(1));
      setSavingOffer(false);
      await load(saved.id || offerId);
    } catch (e) {
      setError(offerSaveFailureMessage(e));
    } finally {
      setSavingOffer(false);
    }
  };

  const confirmExtracted = async (offers: ExtractedOffer[]) => {
    setSavingOffer(true);
    setError(null);
    setSavedNote(null);
    try {
      const ready = filterPersistableOffers(offers);
      if (!ready.length) {
        throw new Error("Nombre y descripción de la oferta son obligatorios");
      }
      let lastId = offerId;
      for (let index = 0; index < ready.length; index += 1) {
        const payload = offerToSavePayload(ready[index]);
        const saved = await postWorkspaceOffer({
          id: index === 0 ? offerId : undefined,
          ...payload,
          includeFathom: index === 0 ? includeFathom : false,
        });
        lastId = saved.id || lastId;
      }
      setReview(null);
      setOfferBlob("");
      setSavedNote(offerSavedLabel(ready.length));
      setSavingOffer(false);
      await load(lastId || null);
    } catch (e) {
      setError(offerSaveFailureMessage(e));
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
        setUploadNote("Revisando si ya estaba…");
        const check = await fetch("/api/workspace/transcripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "check", paste: paste.trim(), offerId }),
        });
        const checked = await check.json();
        if (!check.ok) throw new Error(checked.error || "No pude revisar el texto");
        if (checked.duplicate) {
          setUploadNote(checked.message);
          setPaste("");
          return;
        }
        setUploadNote("Leyendo la llamada…");
        const body = new FormData();
        body.append("offerId", offerId);
        body.append("paste", paste.trim());
        body.append("skipGuide", "1");
        const response = await fetch("/api/workspace/transcripts", { method: "POST", body });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se subieron");
        if (data.duplicate) {
          setUploadNote(data.message);
          setPaste("");
          return;
        }
        setPaste("");
        setUploadNote("Guardé la llamada. Actualizando la guía de la oferta…");
        void fetch("/api/workspace/transcripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offerId, finalize: true }),
        }).then(() => setUploadNote("Listo. La llamada ya está en el CRM."));
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
        <WorkspaceSkeleton />
      </AppShell>
    );
  }

  const parsedCommercial = parseCommercial(commercial);
  const glance = practiceOfferGlance({
    productName,
    productDescription,
    pitchSummary,
    commercial,
  });
  const commission = commissionSummary(parsedCommercial.commission);
  const gaps = crmGaps({ productName, commercial });
  const missingPay = gaps.some((gap) => gap.startsWith("cómo te pagan"));
  const missingPrice = gaps.some((gap) => gap.startsWith("precio"));
  const scripts = parseFollowupScripts(parsedCommercial.scripts);
  const canPractice = Boolean(workspace?.ready || workspace?.canPractice);
  const showComposer = composerOpen || !offerId || Boolean(review) || parsingDoc;
  const showAdjust = adjustOpen || !offerId;
  const visibleScripts = scriptsOpen ? scripts : scripts.slice(0, 2);

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="font-display text-[32px] font-semibold leading-tight tracking-[-0.01em] text-fg0 md:text-[40px]">
              Ofertas
            </h1>
            <p className="max-w-xl text-sm text-fg3">
              Precios, comisión y guiones de la oferta que estás viendo.
            </p>
          </div>
          {canPractice && (
            <Button asChild variant="primary" className="min-h-11 shrink-0">
              <Link href="/practicar">Ir a practicar</Link>
            </Button>
          )}
        </div>
        {savedNote && (
          <p
            className="sticky top-2 z-10 rounded-xl border border-primary/40 bg-primary/5 px-3 py-3 text-sm text-fg0"
            role="status"
          >
            {savedNote}
          </p>
        )}
        {error && (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive">{error}</p>
            {canRetryExtract && (
              <Button type="button" variant="outline" size="sm" onClick={() => void extractOffer()}>
                Reintentar
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(Array.isArray(workspace?.offers) ? workspace.offers : []).map((row) => {
            const bonusCount = savedBonusNames(parseCommercial(row.commercial)).length;
            return (
            <Button
              key={row.id}
              type="button"
              size="sm"
              variant={row.id === offerId ? "primary" : "outline"}
              aria-pressed={row.id === offerId}
              onClick={() => showOffer(row.id)}
            >
              {offerSwitchLabel(row.productName, bonusCount)}
            </Button>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => showOffer(null)}
          >
            <Plus className="h-3.5 w-3.5" />
            Nueva oferta
          </Button>
        </div>
        {offerId && productName ? <p className="text-xs text-fg3">Viendo {productName}.</p> : null}

        {offerId && (
          <section className="space-y-4 rounded-2xl border border-separator1 bg-bg1 p-4 sm:p-5" aria-label="Datos de la oferta">
            <h2 className="font-display text-[22px] font-semibold text-fg0">{productName || "Oferta"}</h2>
            {glance.blurb ? <p className="text-sm text-fg2">{glance.blurb}</p> : null}
            {glance.prices.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-fg3">Precios</p>
                {glance.prices.map((line, index) => (
                  <p key={`${index}-${line}`} className="text-sm text-fg0">
                    {line}
                  </p>
                ))}
              </div>
            ) : missingPrice ? (
              <p className="text-sm text-fg2">Falta el precio.</p>
            ) : null}
            {commission ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-fg3">Comisión</p>
                <p className="mt-1 text-sm text-fg0">{commission}</p>
              </div>
            ) : missingPay ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EBD3A8] bg-[#F6E7CC] px-3 py-3">
                <p className="text-sm font-medium text-[#5E3B0B]">Falta cómo te pagan</p>
                <Button type="button" size="sm" variant="primary" className="min-h-11" onClick={openComposer}>
                  Completar
                </Button>
              </div>
            ) : null}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-fg3">Guiones</p>
              {scripts.length === 0 ? (
                <p className="text-sm text-fg2">
                  Sin guiones en esta oferta.{" "}
                  <Link href="/biblioteca" className="underline">
                    Ver la biblioteca
                  </Link>
                </p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {visibleScripts.map((script, index) => (
                      <li key={`${script.type}-${index}`} className="rounded-xl bg-bg0 px-3 py-2">
                        <p className="text-[11px] font-medium text-fg3">{libraryKindLabel(script.type)}</p>
                        <p className="line-clamp-3 whitespace-pre-wrap text-sm text-fg0">{script.guion}</p>
                      </li>
                    ))}
                  </ul>
                  {scripts.length > 2 && (
                    <button
                      type="button"
                      className="min-h-11 text-sm font-medium text-fg0 underline"
                      onClick={() => setScriptsOpen((open) => !open)}
                    >
                      {scriptsOpen ? "Ver menos" : `Ver los ${scripts.length} guiones`}
                    </button>
                  )}
                </>
              )}
            </div>
            {glance.bonusNames.length > 0 && (
              <details className="text-sm text-fg1">
                <summary className="min-h-11 cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-fg3">
                  Bonos ({glance.bonusNames.length})
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {glance.bonusNames.map((name, index) => (
                    <li key={`${index}-${name}`}>{name}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => (showComposer && offerId ? setComposerOpen(false) : openComposer())}
        >
          {showComposer && offerId ? "Ocultar formulario" : "Añadir / pegar oferta"}
        </Button>
        {showComposer && (
        <div ref={composerRef} className="space-y-4 rounded-2xl border border-separator1 bg-bg1 p-5">
          <h2 className="font-display text-[22px] font-semibold text-fg0">
            {offerId ? "Actualizar desde documento o texto" : "Documento o un texto"}
          </h2>
          <p className="text-sm text-fg3">
            No hace falta ir campo por campo. Si tu comisión cambia según
            cuándo y cómo pague el lead, escríbelo así.
          </p>
          <label className="flex items-center gap-2 text-xs text-fg2 cursor-pointer">
            <Upload className="h-3.5 w-3.5" />
            {parsingDoc ? extractProgress : "Subir PDF, TXT o imagen"}
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
              placeholder="Programa, ticket, formas de pago, plazos, y cómo te pagan comisión según cuándo y cómo pague el cliente…"
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
                {extractProgress}
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
        </div>
        )}

        {offerId && !showAdjust && (
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setAdjustOpen(true)}>
            Ajustar si hace falta
          </Button>
        )}
        {showAdjust && (
        <form
          key={offerId ?? "nueva"}
          onSubmit={onSaveOffer}
          className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-[22px] font-semibold text-fg0">
              {offerId ? "Ajustar si hace falta" : "Revisa y guarda"}
            </h2>
            {offerId && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdjustOpen(false)}>
                Ocultar
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="offer-name">Nombre</Label>
            <Input
              id="offer-name"
              value={productName}
              autoComplete="off"
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
              placeholder="A quién le vendes, promesa, planes, precios, objeciones típicas…"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="offer-pitch">Resumen de la presentación (opcional)</Label>
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
            Usar mis llamadas grabadas en esta oferta
          </label>
          <Button
            type="submit"
            variant="primary"
            disabled={
              savingOffer ||
              parsingDoc ||
              Boolean(review) ||
              !isCompleteOfferSave({ productName, productDescription })
            }
          >
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
        )}

        {offerId &&
          parseFollowupScripts(
            (commercial as { scripts?: unknown } | null)?.scripts,
          ).length > 0 && (
            <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-3">
              <h2 className="text-lg font-light">Publicar en la biblioteca</h2>
              <p className="text-sm text-fg3">
                Sube los guiones de esta oferta como un pack público. Quedas
                como quien lo publicó; el puntaje sale de si otros (y tú) los
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
          <h2 className="font-display text-[22px] font-semibold text-fg0">Llamadas de esta oferta</h2>
          <p className="text-sm text-fg3">
            Sube la carpeta de transcripciones de esta oferta (.txt, .vtt, .srt, .md, .csv, .pdf).
            El video no entra. No hay tope de archivos: se mandan todas y cada una pasa al CRM.
            Deja esta pestaña abierta hasta que diga listo.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/llamadas#conectar-fathom">Traer llamadas grabadas</Link>
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
              placeholder="Tú: …&#10;Cliente: …"
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
            {countPhrase(
              workspace?.transcriptCount || 0,
              "llamada en esta oferta",
              "llamadas en esta oferta",
            )}
            {includeFathom && workspace?.fathomCount
              ? ` (incluye ${countPhrase(workspace.fathomCount, "grabación", "grabaciones")})`
              : ""}
            {workspace?.playbookReady ? " · perfil de prospectos listo" : ""}
            {offerSetupNote(
              (Array.isArray(workspace?.offers) ? workspace.offers : []).find((row) => row.id === offerId),
            )}
          </p>
          {(workspace?.transcripts ?? []).length > 0 && (
            <ul className="text-xs text-fg2 space-y-1 max-h-40 overflow-y-auto">
              {(workspace?.transcripts ?? []).map((row) => (
                <li key={row.id}>{row.title}</li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </AppShell>
  );
}

