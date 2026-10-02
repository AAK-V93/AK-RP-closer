"use client";

import { FormEvent, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
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
  filterPersistableOffers,
  isCompleteOfferSave,
  offerSavedLabel,
  offerSaveFailureMessage,
  postWorkspaceOffer,
} from "@/lib/offer-save";
import {
  commercialRecap,
  crmGaps,
  missingOfferSetupPhrase,
  offerToSavePayload,
  parseCommercial,
  savedBonusNames,
  type ExtractedOffer,
} from "@/lib/offer-commercial";
import { WorkspaceSkeleton } from "@/components/page-skeleton";
import { OfferExtractReview } from "@/components/offer-extract-review";
import { OFFER_EXTRACT_PROGRESS, runOfferExtraction } from "@/lib/offer-upload";
import { partitionTranscriptUploads } from "@/lib/transcript-batch";
import { countPhrase } from "@/lib/plain-labels";

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
    setWorkspace({
      ...data,
      offers: Array.isArray(data.offers) ? data.offers : [],
      transcripts: Array.isArray(data.transcripts) ? data.transcripts : [],
    });
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
              onClick={() => void load(row.id)}
            >
              {row.productName}
              {bonusCount ? ` · ${bonusCount} bonos` : ""}
              {row.readyCrm ? "" : " ·"}
            </Button>
            );
          })}
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
          {!review && commercial && (
            <SavedOfferCommercial commercial={commercial} />
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
              placeholder="A quién le vendes, promesa, planes, precios, objeciones típicas…"
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
          <h2 className="text-lg font-light">2. Llamadas de esta oferta</h2>
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

        {(workspace?.ready || workspace?.canPractice) && (
          <Button asChild variant="primary" className="w-full">
            <Link href="/practicar">Ir a practicar</Link>
          </Button>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </AppShell>
  );
}

function SavedOfferCommercial({ commercial }: { commercial: Record<string, unknown> }) {
  const parsed = parseCommercial(commercial);
  const prices = commercialRecap(parsed);
  const bonuses = savedBonusNames(parsed);
  return (
    <div className="text-xs text-fg2 rounded-xl border border-separator1 px-3 py-2 space-y-2">
      <p className="whitespace-pre-line">
        {prices || "Extraído. Revisa nombre y descripción abajo y guarda."}
      </p>
      {bonuses.length > 0 && (
        <div>
          <p className="font-medium text-fg1">Bonos ({bonuses.length})</p>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {bonuses.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
