"use client";

import { FormEvent, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ClipboardList, Loader2, Mic, Phone, Sparkles, Upload } from "lucide-react";
import { CycleIntro } from "@/components/cycle-intro";
import { HubChat, type HubSnapshot } from "@/components/hub-chat";
import { OfferExtractReview } from "@/components/offer-extract-review";
import { SectionHeading } from "@/components/metric-card";
import { ProjectionCard } from "@/components/projection-card";
import { PushEnable } from "@/components/push-enable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { HomeState } from "@/lib/home-state";
import { offerToSavePayload, type ExtractedOffer } from "@/lib/offer-commercial";

export function HomeScreen() {
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch("/api/hub")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok && !data.snapshot) throw new Error(data.error || "No se pudo cargar");
        setSnapshot(data.snapshot || null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return (
      <p className="text-sm text-fg3 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando inicio…
      </p>
    );
  }

  const home = snapshot?.home;
  const phase = home?.phase || "a";

  return (
    <div className="space-y-6">
      {error && <p className="text-xs text-destructive">{error}</p>}
      {phase === "a" && <OnboardingA home={home} onDone={() => void load()} />}
      {phase === "b" && (
        <NoviceB snapshot={snapshot} onRefresh={() => void load()} />
      )}
      {phase === "c" && (
        <ConfiguredC snapshot={snapshot} onRefresh={() => void load()} />
      )}
    </div>
  );
}

function OnboardingA({
  home,
  onDone,
}: {
  home?: HomeState | null;
  onDone: () => void;
}) {
  const hasCalls = Boolean(home?.hasRealCalls);
  const [step, setStep] = useState<"calls" | "offer">(hasCalls ? "offer" : "calls");
  const [skipCalls, setSkipCalls] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [uploading, setUploading] = useState(false);
  const [offerBlob, setOfferBlob] = useState("");
  const [offerFiles, setOfferFiles] = useState<File[]>([]);
  const [parsing, setParsing] = useState(false);
  const [review, setReview] = useState<{
    assumption: "una" | "varias";
    questions: string[];
    offers: ExtractedOffer[];
  } | null>(null);

  useEffect(() => {
    if (hasCalls) setStep("offer");
  }, [hasCalls]);

  const extractOffer = async (event: FormEvent) => {
    event.preventDefault();
    if (!offerFiles.length && offerBlob.trim().length < 40) {
      setError("Pega un texto o sube un documento de la oferta.");
      return;
    }
    setSaving(true);
    setParsing(true);
    setError(null);
    try {
      const extractBody = new FormData();
      offerFiles.forEach((file) => extractBody.append("files", file));
      if (offerBlob.trim()) extractBody.set("paste", offerBlob.trim());
      const extractedRes = await fetch("/api/offer-from-doc", {
        method: "POST",
        body: extractBody,
      });
      const extracted = await extractedRes.json();
      if (!extractedRes.ok) throw new Error(extracted.error || "No se pudo leer");
      const offers = (extracted.offers || []).length
        ? extracted.offers
        : extracted.productName
          ? [
              {
                productName: extracted.productName,
                productDescription: extracted.productDescription,
                pitchSummary: extracted.pitchSummary || "",
                icp: extracted.icp || "",
                commercial: extracted.commercial,
              },
            ]
          : [];
      if (!offers.length) throw new Error("No encontré una oferta en ese texto");
      setReview({
        assumption: extracted.assumption === "varias" || offers.length > 1 ? "varias" : "una",
        questions: Array.isArray(extracted.questions) ? extracted.questions : [],
        offers,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
      setParsing(false);
    }
  };

  const confirmOffers = async (offers: ExtractedOffer[]) => {
    setSaving(true);
    setError(null);
    try {
      for (let index = 0; index < offers.length; index += 1) {
        const payload = offerToSavePayload(offers[index]);
        const response = await fetch("/api/workspace/offer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            includeFathom: index === 0,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se guardó la oferta");
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const uploadFiles = async (files?: FileList | null) => {
    if (!files?.length && paste.trim().length < 80) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      if (files) {
        Array.from(files).forEach((file) => body.append("files", file));
      }
      if (paste.trim()) body.set("paste", paste);
      const response = await fetch("/api/workspace/transcripts", {
        method: "POST",
        body,
      });
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
        <h1 className="text-3xl font-light">Closer Trainer</h1>
        <p className="text-sm text-fg3">
          Entrenás cierre high-ticket con un agente de voz de práctica que
          habla como tus leads. El coach te corrige. El CRM te dice con quién
          quedar.
        </p>
      </div>
      <CycleIntro />

      {step === "calls" && (
        <div className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
            Un paso
          </p>
          <h2 className="text-xl font-light">Conecta Fathom</h2>
          <p className="text-sm text-fg3">
            Las llamadas nuevas entran solas cuando Fathom termina de
            transcribir. Si aún no grabas, sube lo que tengas de los últimos
            meses.
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="primary">
              <Link href="/llamadas#conectar-fathom">Conectar Fathom</Link>
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
          <button
            type="button"
            className="text-xs text-fg3 underline"
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
          <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
            Un paso
          </p>
          <h2 className="text-xl font-light">Cuéntanos tu oferta</h2>
          <p className="text-sm text-fg3">
            Sube el PDF o escribe todo en un texto: qué vendes, precios, cómo
            paga el lead y cómo te pagan comisión (si cambia según el plazo o
            la forma de pago, dilo así). Extraemos el resto.
          </p>
          {skipCalls && (
            <p className="text-xs text-fg3">
              Sin llamadas reales aún: vas a poder practicar con el playbook de
              la oferta.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
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
              placeholder="Programa, ticket, formas de pago, plazos, y cómo te pagan comisión según cuándo y cómo pague el lead…"
            />
          </div>
          <Button type="submit" variant="primary" disabled={saving || parsing}>
            {saving || parsing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
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
      onRefresh();
    } finally {
      setSavingGoal(false);
    }
  };
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-light">A practicar</h1>
        <p className="text-sm text-fg3">
          El agente de voz de práctica ya puede armarse con el playbook de tu
          oferta. El CRM aparece solo cuando entre la primera llamada real.
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Button asChild variant="primary" className="h-auto py-4 justify-start">
          <Link href="/practicar" className="flex items-start gap-3 text-left">
            <Mic className="h-5 w-5 mt-0.5" />
            <span>
              <span className="block text-base">Práctica por voz</span>
              <span className="block text-xs font-normal opacity-80">
                Prospecto según tu ICP y objeciones
              </span>
            </span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto py-4 justify-start">
          <Link href="/coach" className="flex items-start gap-3 text-left">
            <Sparkles className="h-5 w-5 mt-0.5" />
            <span>
              <span className="block text-base">Coach</span>
              <span className="block text-xs font-normal text-fg3">
                Insights y chat
              </span>
            </span>
          </Link>
        </Button>
      </div>
      <p className="text-xs text-fg3 rounded-xl border border-separator1 px-3 py-2">
        Cuando tengas tu primera llamada real, conecta Fathom o súbela y se
        activa tu CRM.
      </p>
    </div>
  );
}

function ConfiguredC({
  snapshot,
  onRefresh,
}: {
  snapshot: HubSnapshot | null;
  onRefresh: () => void;
}) {
  const desk = snapshot?.desk;
  const [savingGoal, setSavingGoal] = useState(false);
  const saveGoal = async (usd: number) => {
    setSavingGoal(true);
    try {
      await fetch("/api/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyGoalUsd: usd }),
      });
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
      <PushEnable needsPrompt={snapshot?.needsPushPrompt} onDone={onRefresh} />
      <div className="space-y-4">
        <SectionHeading>Qué hacer</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <HomeCard
            href="/llamadas"
            icon={<Phone className="h-5 w-5" />}
            title="Analizar"
            status={desk?.analyzeStatus || "Todo al día"}
          />
          <HomeCard
            href={desk?.practiceHref || "/practicar"}
            icon={<Mic className="h-5 w-5" />}
            title="Práctica"
            status={desk?.practiceStatus || "Elige con quién practicar"}
          />
          <HomeCard
            href="/crm#seguimientos"
            icon={<ClipboardList className="h-5 w-5" />}
            title="Seguimientos"
            status={desk?.followupStatus || "Todo al día"}
            attention={Boolean(desk?.followupStatus && desk.followupStatus !== "Todo al día")}
          />
          <HomeCard
            href="/coach"
            icon={<Sparkles className="h-5 w-5" />}
            title="Coach"
            status={desk?.coachStatus || "Sin novedades"}
          />
        </div>
      </div>
      <HubChat variant="dock" initialSnapshot={snapshot} />
    </div>
  );
}

function HomeCard({
  href,
  icon,
  title,
  status,
  attention,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  status: string;
  attention?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[120px] flex-col justify-between rounded-2xl border border-separator1 bg-bg1 px-5 py-5 text-left"
    >
      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-fg3">
        {icon}
        {title}
      </span>
      <span className={`font-heading text-xl font-bold leading-tight ${attention ? "text-tone-attention" : "text-fg0"}`}>
        {status}
      </span>
    </Link>
  );
}
