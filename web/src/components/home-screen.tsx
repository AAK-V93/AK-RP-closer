"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Mic, Phone, Sparkles, Upload } from "lucide-react";
import { CycleIntro } from "@/components/cycle-intro";
import { HubChat, type HubSnapshot } from "@/components/hub-chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { HomeState } from "@/lib/home-state";

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
      {phase === "b" && <NoviceB />}
      {phase === "c" && <ConfiguredC snapshot={snapshot} />}
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pitch, setPitch] = useState("");
  const [pct, setPct] = useState("3");
  const [parsing, setParsing] = useState(false);
  const [paste, setPaste] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (hasCalls) setStep("offer");
  }, [hasCalls]);

  const saveOffer = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const pctN = Number(pct.replace(",", ".")) / 100;
      const response = await fetch("/api/workspace/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: name,
          productDescription: description,
          pitchSummary: pitch,
          includeFathom: true,
          commercial: {
            commission: Number.isFinite(pctN)
              ? {
                  pctBase: pctN,
                  umbralAcumuladoUsd: 70000,
                  pctSobreUmbral: Math.max(pctN, 0.05),
                  base: "cash_collected",
                  periodoAcumulacion: "mensual",
                }
              : null,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se guardó la oferta");
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
          Entrenás cierre high-ticket con un bot que habla como tus leads. El
          coach te corrige. El CRM te dice con quién quedar.
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
              <Link href="/llamadas">Conectar Fathom</Link>
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

      {step === "offer" && (
        <form onSubmit={saveOffer} className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
            Un paso
          </p>
          <h2 className="text-xl font-light">Cuéntanos tu oferta</h2>
          <p className="text-sm text-fg3">
            PDF o documento de cada programa, más tu % de comisión. Lo que
            falte lo pregunta el hub.
          </p>
          {skipCalls && (
            <p className="text-xs text-fg3">
              Sin llamadas reales aún: vas a poder practicar con el playbook de
              la oferta.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <label className="block">
            <span className="text-xs text-fg3">PDF / documento</span>
            <Input
              type="file"
              accept=".pdf,.txt,.md,.doc,.docx"
              disabled={parsing}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setParsing(true);
                setError(null);
                try {
                  const body = new FormData();
                  body.set("file", file);
                  const response = await fetch("/api/offer-from-doc", {
                    method: "POST",
                    body,
                  });
                  const data = await response.json();
                  if (!response.ok) throw new Error(data.error || "No se pudo leer");
                  setName(data.productName || "");
                  setDescription(data.productDescription || "");
                  setPitch(data.pitchSummary || "");
                  const rawPct = data.commercial?.commission?.pctBase;
                  if (typeof rawPct === "number") setPct(String(Math.round(rawPct * 1000) / 10));
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Error");
                } finally {
                  setParsing(false);
                }
              }}
            />
          </label>
          <div className="space-y-1">
            <Label htmlFor="onb-name">Nombre del programa</Label>
            <Input
              id="onb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="onb-desc">Qué es</Label>
            <Textarea
              id="onb-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="onb-pitch">Pitch (opcional)</Label>
            <Textarea
              id="onb-pitch"
              value={pitch}
              onChange={(e) => setPitch(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="onb-pct">Tu comisión %</Label>
            <Input
              id="onb-pct"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <Button type="submit" variant="primary" disabled={saving || parsing}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continuar"}
          </Button>
        </form>
      )}
    </div>
  );
}

function NoviceB() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-light">A practicar</h1>
        <p className="text-sm text-fg3">
          El bot ya puede armarse con el playbook de tu oferta. El CRM aparece
          solo cuando entre la primera llamada real.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button asChild variant="primary" className="h-auto py-4 justify-start">
          <Link href="/practicar" className="flex items-start gap-3 text-left">
            <Mic className="h-5 w-5 mt-0.5" />
            <span>
              <span className="block text-base">Practicar con el bot</span>
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
}: {
  snapshot: HubSnapshot | null;
}) {
  const last = snapshot?.home?.lastUnanalyzed;
  return (
    <div className="space-y-6">
      <div className="grid gap-3">
        <Button asChild variant="primary" className="h-auto py-4 justify-start">
          <Link href="/llamadas" className="flex items-start gap-3 text-left">
            <Phone className="h-5 w-5 mt-0.5" />
            <span>
              <span className="block text-base">Analizar llamada real</span>
              <span className="block text-xs font-normal opacity-80">
                {last
                  ? `Sin auditar: ${last.title}`
                  : "Últimas en Llamadas"}
              </span>
            </span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto py-4 justify-start">
          <Link href="/practicar" className="flex items-start gap-3 text-left">
            <Mic className="h-5 w-5 mt-0.5" />
            <span>
              <span className="block text-base">Practicar con el bot</span>
              <span className="block text-xs font-normal text-fg3">
                Compose o replay
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
                Guía viva, insights y chat
              </span>
            </span>
          </Link>
        </Button>
      </div>
      <HubChat variant="dock" initialSnapshot={snapshot} />
    </div>
  );
}
