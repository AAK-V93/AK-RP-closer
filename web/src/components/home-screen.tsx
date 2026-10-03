"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Upload } from "lucide-react";
import { HomeSkeleton } from "@/components/page-skeleton";
import { CycleIntro } from "@/components/cycle-intro";
import { HubChat, type HubSnapshot } from "@/components/hub-chat";
import { OfferExtractReview } from "@/components/offer-extract-review";
import { ProjectionCard } from "@/components/projection-card";
import { PushEnable } from "@/components/push-enable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { HomeState } from "@/lib/home-state";
import { moneyLabel } from "@/lib/crm-operacion";
import { ACTIVA_EXPLAIN } from "@/lib/crm-activa";
import { dineroEnJuegoNote, saldoPorCobrarNote } from "@/lib/crm-pipeline";
import { PipelineDetail } from "@/components/pipeline-detail";
import { DeskRowStatus } from "@/components/desk-row-status";
import { followupCardStatus } from "@/lib/home-desk";
import {
  filterPersistableOffers,
  offerSavedLabel,
  offerSaveFailureMessage,
  postWorkspaceOffer,
} from "@/lib/offer-save";
import { offerToSavePayload, type ExtractedOffer } from "@/lib/offer-commercial";
import { OFFER_EXTRACT_PROGRESS, runOfferExtraction } from "@/lib/offer-upload";
import { HUB_RETRY_MS, hubLoadRetry, invalidateHub, loadHub } from "@/lib/hub-client";

export function HomeScreen({ initialSnapshot = null }: { initialSnapshot?: HubSnapshot | null }) {
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(initialSnapshot);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const retryAttempt = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const load = (force = false) =>
    loadHub({ force })
      .then((data) => {
        retryAttempt.current = 0;
        setError(null);
        setSnapshot((data.snapshot as HubSnapshot | null) || null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "No pude cargar el inicio.");
        const mode = hubLoadRetry({
          attempt: retryAttempt.current,
          hasSnapshot: Boolean(snapshotRef.current?.home),
        });
        if (mode === "auto") {
          retryAttempt.current += 1;
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null;
            setLoading(true);
            void load(true);
          }, HUB_RETRY_MS);
        }
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    void load();
    return () => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
    // Mount only. A later snapshot must not start another GET.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <HomeSkeleton />;
  }

  const home = snapshot?.home;
  if (!home) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {error || "No pude cargar el inicio. Pulsa Reintentar."}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setError(null);
            setLoading(true);
            void load(true);
          }}
        >
          Reintentar
        </Button>
      </div>
    );
  }

  const phase =
    home.offersUnreadable && home.phase === "a" ? (home.hasRealCalls ? "c" : "b") : home.phase;

  return (
    <div className="space-y-6">
      {error && <p className="text-xs text-destructive">{error}</p>}
      {home.offersUnreadable && (
        <p className="text-sm text-destructive">
          No pude leer tu oferta. Recarga si el inicio se ve incompleto.
        </p>
      )}
      {notice && (
        <p className="text-sm text-fg0 rounded-xl border border-primary/40 bg-primary/5 px-3 py-3" role="status">
          {notice}
        </p>
      )}
      {phase === "a" && (
        <OnboardingA home={home} onDone={() => void load()} onSaved={setNotice} />
      )}
      {phase === "b" && (
        <NoviceB snapshot={snapshot} onRefresh={() => void load(true)} />
      )}
      {phase === "c" && (
        <ConfiguredC
          snapshot={snapshot}
          onRefresh={() => void load(true)}
          onLiveSnapshot={(next) => setSnapshot(next)}
        />
      )}
    </div>
  );
}

function OnboardingA({
  home,
  onDone,
  onSaved,
}: {
  home?: HomeState | null;
  onDone: () => void;
  onSaved: (message: string) => void;
}) {
  const hasCalls = Boolean(home?.hasRealCalls);
  const [step, setStep] = useState<"calls" | "offer">(hasCalls ? "offer" : "calls");
  const [skipCalls, setSkipCalls] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [offerBlob, setOfferBlob] = useState("");
  const [offerFiles, setOfferFiles] = useState<File[]>([]);
  const [parsing, setParsing] = useState(false);
  const [extractProgress, setExtractProgress] = useState(OFFER_EXTRACT_PROGRESS);
  const [canRetryExtract, setCanRetryExtract] = useState(false);
  const extractGen = useRef(0);
  const [review, setReview] = useState<{
    assumption: "una" | "varias";
    questions: string[];
    offers: ExtractedOffer[];
  } | null>(null);

  useEffect(() => {
    if (hasCalls) setStep("offer");
  }, [hasCalls]);

  const extractOffer = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!offerFiles.length && offerBlob.trim().length < 40) {
      setError("Pega un texto o sube un documento de la oferta.");
      return;
    }
    const gen = ++extractGen.current;
    setSaving(true);
    setParsing(true);
    setError(null);
    setCanRetryExtract(false);
    try {
      const extracted = await runOfferExtraction({
        files: offerFiles,
        paste: offerBlob,
        onProgress: (message) => {
          if (gen === extractGen.current) setExtractProgress(message);
        },
      });
      if (gen !== extractGen.current) return;
      setReview(extracted);
    } catch (e) {
      if (gen !== extractGen.current) return;
      setCanRetryExtract(true);
      setError(e instanceof Error ? e.message : "No pude leer ese documento. Pulsa Reintentar.");
    } finally {
      if (gen === extractGen.current) {
        setSaving(false);
        setParsing(false);
      }
    }
  };

  const confirmOffers = async (offers: ExtractedOffer[]) => {
    setSaving(true);
    setError(null);
    try {
      const ready = filterPersistableOffers(offers);
      if (!ready.length) {
        throw new Error("Nombre y descripción de la oferta son obligatorios");
      }
      for (let index = 0; index < ready.length; index += 1) {
        const payload = offerToSavePayload(ready[index]);
        await postWorkspaceOffer({
          ...payload,
          includeFathom: index === 0,
        });
      }
      onSaved(offerSavedLabel(ready.length));
      setReview(null);
      onDone();
    } catch (e) {
      setError(offerSaveFailureMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const uploadFiles = async (files?: FileList | null) => {
    if (!files?.length && paste.trim().length < 80) return;
    setUploading(true);
    setError(null);
    setUploadNote(null);
    try {
      if (!files?.length && paste.trim()) {
        setUploadNote("Revisando si ya estaba…");
        const check = await fetch("/api/workspace/transcripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "check", paste: paste.trim() }),
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
        body.set("paste", paste.trim());
        body.set("skipGuide", "1");
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
          body: JSON.stringify({ finalize: true }),
        }).then(() => setUploadNote("Listo. La llamada ya está en el CRM."));
        onDone();
        return;
      }
      const body = new FormData();
      if (files) Array.from(files).forEach((file) => body.append("files", file));
      const response = await fetch("/api/workspace/transcripts", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se subieron");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-4xl text-fg0">Closer Trainer</h1>
        <p className="text-sm text-fg3">
          Entrenas cierre de alto valor con un agente de voz de práctica que
          habla como tus prospectos. El coach te corrige. El CRM te dice con quién
          quedar.
        </p>
      </div>
      <CycleIntro />

      {step === "calls" && (
        <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4">
          <h2 className="font-display text-3xl text-fg0">Conecta tus llamadas</h2>
          <p className="text-sm text-fg3">
            Las llamadas nuevas entran solas cuando termina la transcripción.
            Si aún no grabas, sube lo que tengas de los últimos meses.
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="primary">
              <Link href="/llamadas#conectar-fathom">Conectar grabaciones</Link>
            </Button>
            <label className="inline-flex">
              <Button type="button" variant="outline" asChild disabled={uploading}>
                <span>
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Sube transcripciones
                </span>
              </Button>
              <input
                type="file"
                className="hidden"
                multiple
                accept=".txt,.md,.vtt,.srt,text/plain"
                onChange={(e) => void uploadFiles(e.target.files)}
              />
            </label>
          </div>
          <Textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={3}
            placeholder="O pega una transcripción aquí (mín. un párrafo)"
          />
          {paste.trim().length >= 80 && (
            <Button
              type="button"
              variant="outline"
              disabled={uploading}
              onClick={() => void uploadFiles()}
            >
              Guardar texto pegado
            </Button>
          )}
          {uploadNote && <p className="text-sm text-fg2">{uploadNote}</p>}
          <button
            type="button"
            className="inline-flex min-h-11 items-center text-xs text-fg3 underline lg:min-h-0"
            onClick={() => {
              setSkipCalls(true);
              setStep("offer");
            }}
          >
            Todavía no tengo llamadas
          </button>
        </div>
      )}

      {step === "offer" && !review && (
        <form onSubmit={extractOffer} className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4">
          <h2 className="font-display text-3xl text-fg0">Cuéntanos tu oferta</h2>
          <p className="text-sm text-fg3">
            Sube el PDF o escribe todo en un texto: qué vendes, precios, cómo
            paga el lead y cómo te pagan comisión (si cambia según el plazo o
            la forma de pago, dilo así). Extraemos el resto.
          </p>
          {skipCalls && (
            <p className="text-xs text-fg3">
              Sin llamadas reales aún: vas a poder practicar con el perfil de
              la oferta.
            </p>
          )}
          {error && (
            <div className="space-y-2">
              <p className="text-xs text-destructive">{error}</p>
              {canRetryExtract && (
                <Button type="button" variant="outline" size="sm" onClick={() => void extractOffer()}>
                  Reintentar
                </Button>
              )}
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-xs text-fg3">PDF / documento (varios si hay)</span>
            <Input
              type="file"
              multiple
              accept=".pdf,.txt,.md,.png,.jpg,.jpeg,application/pdf,text/plain,image/*"
              disabled={parsing}
              onChange={(e) => {
                setOfferFiles(Array.from(e.target.files || []));
              }}
            />
            {offerFiles.length > 0 && (
              <p className="text-xs text-fg3">
                {offerFiles.map((file) => file.name).join(", ")}
              </p>
            )}
          </label>
          <div className="space-y-1">
            <Label htmlFor="onb-blob">O un solo texto</Label>
            <Textarea
              id="onb-blob"
              value={offerBlob}
              onChange={(e) => setOfferBlob(e.target.value)}
              rows={8}
              placeholder="Programa, ticket, formas de pago, plazos, y cómo te pagan comisión según cuándo y cómo pague el cliente…"
            />
          </div>
          <Button type="submit" variant="primary" disabled={saving || parsing}>
            {saving || parsing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {extractProgress}
              </>
            ) : (
              "Extraer"
            )}
          </Button>
        </form>
      )}

      {step === "offer" && review && (
        <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4">
          {error && <p className="text-xs text-destructive">{error}</p>}
          <OfferExtractReview
            batch={review}
            saving={saving}
            onBack={() => setReview(null)}
            onConfirm={(offers) => void confirmOffers(offers)}
          />
        </div>
      )}
    </div>
  );
}

function NoviceB({
  snapshot,
  onRefresh,
}: {
  snapshot: HubSnapshot | null;
  onRefresh: () => void;
}) {
  const [savingGoal, setSavingGoal] = useState(false);
  const saveGoal = async (usd: number) => {
    setSavingGoal(true);
    try {
      await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyGoalUsd: usd }),
      });
      invalidateHub();
      onRefresh();
    } finally {
      setSavingGoal(false);
    }
  };
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-4xl text-fg0">A practicar</h1>
        <p className="text-sm text-fg3">
          El agente de voz de práctica ya puede armarse con el perfil de tus
          prospectos. El CRM aparece solo cuando entre la primera llamada real.
        </p>
      </div>
      {snapshot?.needsMonthlyGoal && (
        <ProjectionCard
          projection={null}
          needsGoal
          saving={savingGoal}
          onSaveGoal={saveGoal}
        />
      )}
      <PushEnable needsPrompt={snapshot?.needsPushPrompt} onDone={onRefresh} />
      <div className="divide-y divide-separator1 border-t border-separator1">
        <Link href="/practicar" className="flex items-baseline justify-between gap-4 py-4">
          <span className="text-fg0">Práctica por voz</span>
          <span className="text-sm text-fg3">Prospecto según tu oferta</span>
        </Link>
        <Link href="/coach" className="flex items-baseline justify-between gap-4 py-4">
          <span className="text-fg0">Coach</span>
          <span className="text-sm text-fg3">Lo que se repite en tus llamadas</span>
        </Link>
      </div>
      <p className="text-xs text-fg3 rounded-xl border border-separator1 px-3 py-2">
        Cuando tengas tu primera llamada real, conecta las grabaciones o súbela y se
        activa tu CRM.
      </p>
    </div>
  );
}

function ConfiguredC({
  snapshot,
  onRefresh,
  onLiveSnapshot,
}: {
  snapshot: HubSnapshot | null;
  onRefresh: () => void;
  onLiveSnapshot: (next: HubSnapshot) => void;
}) {
  const desk = snapshot?.desk;
  const [practice, setPractice] = useState<{
    practiceHref: string;
    practiceStatus: string;
    newPattern: boolean;
  } | null>(null);
  const [savingGoal, setSavingGoal] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/hub/practice")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { practiceHref?: string; practiceStatus?: string; newPattern?: boolean } | null) => {
        if (cancelled || !data?.practiceStatus) return;
        setPractice({
          practiceHref: data.practiceHref || "/practicar",
          practiceStatus: data.practiceStatus,
          newPattern: Boolean(data.newPattern),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const saveGoal = async (usd: number) => {
    setSavingGoal(true);
    try {
      await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyGoalUsd: usd }),
      });
      invalidateHub();
      toast({
        title: `Guardé tu meta: USD ${Math.round(usd)}`,
        duration: 3000,
      });
      onRefresh();
    } finally {
      setSavingGoal(false);
    }
  };
  return (
    <div className="space-y-8">
      <ProjectionCard
        projection={snapshot?.projection || null}
        needsGoal={snapshot?.needsMonthlyGoal}
        saving={savingGoal}
        onSaveGoal={saveGoal}
      />
      <div>
        <h2 className="text-sm text-fg3">De un vistazo</h2>
        <div className="mt-1 divide-y divide-separator1 border-t border-separator1">
          <HomeRow
            href="/crm?activas=1#operacion"
            title="Leads activos"
            status={String(snapshot?.now?.oportunidadesActivas || 0)}
          />
          <HomeRow
            href="/crm#seguimientos"
            title="Acciones de hoy"
            status={followupCardStatus(
              snapshot?.now?.seguimientosHoy || 0,
              snapshot?.now?.seguimientosVencidos || 0,
            )}
          />
          <HomeRow
            href="/crm#seguimientos"
            title="Dinero en juego"
            status={moneyLabel(snapshot?.now?.dineroEnJuego)}
          />
          <HomeRow
            href="/crm#dashboard"
            title="Saldo por cobrar"
            status={moneyLabel(snapshot?.now?.saldoPorCobrar || 0)}
          />
        </div>
        <p className="mt-2 text-xs text-fg3">{ACTIVA_EXPLAIN}</p>
        <p className="mt-1 text-xs text-fg3">
          {dineroEnJuegoNote(snapshot?.now?.pipelineLeads || 0)}
        </p>
        {snapshot && (
          <div className="mt-2 min-w-0">
            <PipelineDetail
              lines={snapshot.pipelineDetalle || []}
              format={(amount) => moneyLabel(amount)}
            />
          </div>
        )}
        <p className="mt-1 text-xs text-fg3">{saldoPorCobrarNote(snapshot?.now?.saldoPorCobrar || 0)}</p>
      </div>
      <PushEnable needsPrompt={snapshot?.needsPushPrompt} onDone={onRefresh} />
      <div>
        <h2 className="text-sm text-fg3">Qué hacer</h2>
        <div className="mt-1 divide-y divide-separator1 border-t border-separator1">
          <HomeRow href="/llamadas" title="Analizar" status={desk?.analyzeStatus || "Todo al día"} />
          <HomeRow
            href={practice?.practiceHref || desk?.practiceHref || "/practicar"}
            title="Práctica"
            status={practice?.practiceStatus || desk?.practiceStatus || "Elige con quién practicar"}
          />
          <HomeRow
            href="/crm#seguimientos"
            title="Seguimientos"
            status={desk?.followupStatus || "Todo al día"}
          />
          <HomeRow
            href="/coach"
            title="Coach"
            status={
              practice?.newPattern ? "Nuevo patrón detectado" : desk?.coachStatus || "Sin novedades"
            }
          />
          <HomeRow href="/ofertas" title="Oferta" status="Precios, pagos y comisión" />
        </div>
      </div>
      <HubChat
        variant="dock"
        initialSnapshot={snapshot}
        onSnapshot={(next) => {
          if (next) onLiveSnapshot(next);
        }}
      />
    </div>
  );
}

function HomeRow({ href, title, status }: { href: string; title: string; status: string }) {
  return (
    <Link href={href} className="flex items-start justify-between gap-4 py-4" title={status}>
      <span className="shrink-0 text-fg0">{title}</span>
      <DeskRowStatus status={status} />
    </Link>
  );
}
