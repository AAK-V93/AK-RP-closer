"use client";

import { useEffect, useState } from "react";
import { closerSpanish } from "@/lib/closer-spanish";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { countPhrase } from "@/lib/plain-labels";
import { practiceOfferLoadState } from "@/lib/practice-offer-glance";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTraining } from "@/hooks/use-training-state";
import {
  CALL_SECTION_LABELS,
  DIFFICULTY_LABELS,
  PRACTICE_KIND_LABELS,
  CallSection,
  DifficultyLevel,
} from "@/data/training-session";
import { LANGUAGES, LanguageCode } from "@/data/languages";
import { VoiceId, voices } from "@/data/voices";
import {
  requiresPitchSummary,
  shouldShowProspectBrief,
} from "@/lib/prospect-prompt";
import { ProspectBrief } from "@/components/prospect-brief";
import { useConnection } from "@/hooks/use-connection";
import { RefreshCw } from "lucide-react";
import type { LeadPlaybook } from "@/lib/lead-playbook";
import type { ReplayCall } from "@/lib/replay-call";
import { practiceOfferGlance } from "@/lib/practice-offer-glance";

const schema = z.object({
  difficulty: z.enum(["easy", "medium", "hard"]),
  callSection: z.enum(["full", "discovery", "pitch", "close", "pitch_close"]),
  language: z.enum(["es", "en", "pt", "fr"]),
  voice: z.nativeEnum(VoiceId),
  pitchSummary: z.string().optional(),
});

type WorkspaceOffer = {
  id: string;
  productName: string;
  productDescription: string;
  pitchSummary: string;
  commercial?: unknown;
};

export function HowToPracticeButton({ className }: { className?: string }) {
  const [howOpen, setHowOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn(
          "h-auto min-h-11 justify-start whitespace-normal px-3 py-2 text-left text-base font-semibold",
          className,
        )}
        onClick={() => setHowOpen(true)}
      >
        Cómo practicar
      </Button>
      <Dialog open={howOpen} onOpenChange={setHowOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogTitle>Cómo practicar</DialogTitle>
          <DialogDescription>
            Tú abres la reunión. El prospecto ya está en la llamada, en silencio.
          </DialogDescription>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-fg2">
            <li>Revisa la oferta de este panel.</li>
            <li>Elige un prospecto nuevo, o recrea una llamada que no cerró.</li>
            <li>Pulsa Entrar a la reunión.</li>
            <li>Permite el micrófono y saluda: quién eres y por qué se reunieron.</li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TrainingSetupForm() {
  const { trainingState, dispatch } = useTraining();
  const { shouldConnect } = useConnection();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus")?.trim() || "";
  const modeParam = searchParams.get("mode")?.trim();
  const callParam = searchParams.get("call")?.trim() || "";
  const sectionParam = searchParams.get("section")?.trim() || "";
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [offers, setOffers] = useState<WorkspaceOffer[]>([]);
  const [offer, setOffer] = useState<WorkspaceOffer | null>(null);
  const [offerStatus, setOfferStatus] = useState<"loading" | "error" | "empty" | "ready">("loading");
  const [ready, setReady] = useState(false);
  const [transcriptCount, setTranscriptCount] = useState(0);
  const [playbookReady, setPlaybookReady] = useState(false);
  const [openCalls, setOpenCalls] = useState<
    {
      source: "fathom" | "upload";
      sourceId: string;
      title: string;
      leadName: string;
      result: string;
      date: string | null;
    }[]
  >([]);
  const [loadingReplay, setLoadingReplay] = useState(false);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      difficulty: trainingState.training.difficulty,
      callSection: trainingState.training.callSection,
      language: trainingState.training.language,
      voice: trainingState.sessionConfig.voice,
      pitchSummary: trainingState.training.pitchSummary || "",
    },
  });

  const callSection = form.watch("callSection");
  const showBrief = shouldShowProspectBrief(callSection);
  const needsPitch = requiresPitchSummary(callSection);
  const practiceKind = trainingState.training.practiceKind || "compose";

  useEffect(() => {
    if (!focus) return;
    dispatch({ type: "SET_TRAINING", payload: { practiceFocus: closerSpanish(focus) } });
  }, [dispatch, focus]);

  useEffect(() => {
    if (
      sectionParam !== "full" &&
      sectionParam !== "discovery" &&
      sectionParam !== "pitch" &&
      sectionParam !== "close" &&
      sectionParam !== "pitch_close"
    ) {
      return;
    }
    form.setValue("callSection", sectionParam);
    dispatch({ type: "SET_TRAINING", payload: { callSection: sectionParam } });
  }, [dispatch, form, sectionParam]);

  useEffect(() => {
    const current = form.getValues("callSection");
    if (trainingState.training.callSection !== current) {
      form.setValue("callSection", trainingState.training.callSection);
    }
  }, [form, trainingState.training.callSection]);

  useEffect(() => {
    if (modeParam === "replay" || modeParam === "compose") {
      dispatch({
        type: "SET_TRAINING",
        payload: {
          practiceKind: modeParam,
          replayCall: modeParam === "compose" ? null : trainingState.training.replayCall,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed from URL once
  }, [dispatch, modeParam]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => setServerReady(data.ready))
      .catch(() => setServerReady(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const applyWorkspace = (data: {
      offers?: WorkspaceOffer[];
      offer?: WorkspaceOffer | null;
      ready?: boolean;
      canPractice?: boolean;
      transcriptCount?: number;
      playbookReady?: boolean;
      playbook?: LeadPlaybook | null;
    }) => {
      const state = practiceOfferLoadState({ ok: true, offer: data.offer });
      setOfferStatus(state);
      setOffers(data.offers || []);
      setOffer(data.offer || null);
      setReady(Boolean(data.ready || data.canPractice));
      setTranscriptCount(data.transcriptCount || 0);
      setPlaybookReady(Boolean(data.playbookReady));
      if (data.offer) {
        dispatch({
          type: "SET_TRAINING",
          payload: {
            offerId: data.offer.id,
            productName: data.offer.productName,
            productDescription: data.offer.productDescription,
            pitchSummary: form.getValues("pitchSummary") || data.offer.pitchSummary,
            leadPlaybook: (data.playbook as LeadPlaybook) || null,
          },
        });
        if (data.offer.pitchSummary && !form.getValues("pitchSummary")) {
          form.setValue("pitchSummary", data.offer.pitchSummary);
        }
      }
    };
    const loadWorkspace = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch("/api/workspace");
          const data = await response.json().catch(() => ({}));
          if (cancelled) return;
          if (practiceOfferLoadState({ ok: response.ok, offer: data.offer }) === "error") {
            if (attempt === 0) continue;
            setOffer(null);
            setOfferStatus("error");
            return;
          }
          applyWorkspace(data);
          return;
        } catch {
          if (attempt === 0) continue;
          if (!cancelled) {
            setOffer(null);
            setOfferStatus("error");
          }
        }
      }
    };
    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [dispatch, form]);

  useEffect(() => {
    const subscription = form.watch((values) => {
      dispatch({
        type: "SET_TRAINING",
        payload: {
          difficulty: values.difficulty as DifficultyLevel,
          callSection: values.callSection as CallSection,
          language: values.language as LanguageCode,
          pitchSummary: values.pitchSummary || "",
        },
      });
      if (values.voice) {
        dispatch({
          type: "SET_SESSION_CONFIG",
          payload: { voice: values.voice as VoiceId },
        });
      }
    });
    return () => subscription.unsubscribe();
  }, [form, dispatch]);

  const selectReplay = async (source: "fathom" | "upload", sourceId: string) => {
    setLoadingReplay(true);
    try {
      const response = await fetch(
        `/api/practice-calls?source=${encodeURIComponent(source)}&id=${encodeURIComponent(sourceId)}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se cargó");
      dispatch({
        type: "SET_TRAINING",
        payload: {
          practiceKind: "replay",
          replayCall: data.replay as ReplayCall,
        },
      });
    } catch {
      /* keep previous */
    } finally {
      setLoadingReplay(false);
    }
  };

  useEffect(() => {
    if (!offer?.id) return;
    fetch(`/api/practice-calls?offerId=${encodeURIComponent(offer.id)}`)
      .then((r) => r.json())
      .then((data) => setOpenCalls(data.calls || []))
      .catch(() => setOpenCalls([]));
  }, [offer?.id]);

  useEffect(() => {
    if (!callParam || !callParam.includes(":")) return;
    const [source, ...rest] = callParam.split(":");
    const sourceId = rest.join(":");
    if (source !== "fathom" && source !== "upload") return;
    void selectReplay(source, sourceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callParam]);

  return (
    <Form {...form}>
      <form className="flex flex-col md:h-full">
        {serverReady === false && (
          <p className="text-xs text-destructive py-2">
            Falta la configuración del servicio de voz.
          </p>
        )}

        <div className="space-y-4 py-2 md:min-h-0 md:flex-grow md:overflow-y-auto md:py-4">
          <div className="rounded-lg border border-separator1 bg-bg0 p-3 space-y-2">
            <p className="text-sm font-semibold text-fg0">Tu oferta</p>
            {offers.length > 1 && (
              <select
                className="w-full rounded-md border border-separator1 bg-bg1 px-2 py-1.5 text-sm"
                value={offer?.id || ""}
                disabled={shouldConnect}
                onChange={(event) => {
                  const id = event.target.value;
                  fetch(`/api/workspace?offerId=${encodeURIComponent(id)}`)
                    .then(async (response) => {
                      const data = await response.json().catch(() => ({}));
                      if (practiceOfferLoadState({ ok: response.ok, offer: data.offer }) === "error") {
                        setOfferStatus("error");
                        return null;
                      }
                      return data;
                    })
                    .then((data) => {
                      if (!data) return;
                      setOfferStatus(practiceOfferLoadState({ ok: true, offer: data.offer }));
                      setOffer(data.offer);
                      setReady(Boolean(data.ready || data.canPractice));
                      setTranscriptCount(data.transcriptCount || 0);
                      setPlaybookReady(Boolean(data.playbookReady));
                      if (data.offer) {
                        dispatch({
                          type: "SET_TRAINING",
                          payload: {
                            offerId: data.offer.id,
                            productName: data.offer.productName,
                            productDescription: data.offer.productDescription,
                            pitchSummary: data.offer.pitchSummary,
                            leadPlaybook: (data.playbook as LeadPlaybook) || null,
                          },
                        });
                      }
                    })
                    .catch(() => setOfferStatus("error"));
                }}
              >
                {offers.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.productName}
                  </option>
                ))}
              </select>
            )}
            {offerStatus === "loading" && (
              <p className="text-xs text-fg3">Leyendo tu oferta…</p>
            )}
            {offerStatus === "error" && (
              <p className="text-xs text-destructive">No pude leer tu oferta. Recarga la página.</p>
            )}
            {offerStatus === "ready" && offer ? (
              <>
                <OfferGlance offer={offer} />
                <p className="text-xs text-fg3">
                  {countPhrase(transcriptCount, "llamada real", "llamadas reales")}
                  {playbookReady ? " · emulando a tus prospectos" : ""}
                </p>
                {trainingState.training.prospectProfile.leadTypeName && (
                  <p className="text-xs text-fg2 text-pretty">
                    Tipo de esta práctica: {trainingState.training.prospectProfile.leadTypeName}
                  </p>
                )}
              </>
            ) : null}
            {offerStatus === "empty" && (
              <p className="text-xs text-fg3">Aún no hay oferta guardada.</p>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href="/ofertas">
                {ready ? "Editar oferta y llamadas" : "Subir oferta y llamadas"}
              </Link>
            </Button>
            {trainingState.training.practiceFocus && practiceKind === "compose" && (
              <p className="text-xs text-primary">
                Objetivo: {closerSpanish(trainingState.training.practiceFocus)}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <HowToPracticeButton className="w-full" />
            <div className="grid grid-cols-1 gap-2">
              <Button
                type="button"
                size="sm"
                variant={practiceKind === "compose" ? "primary" : "outline"}
                disabled={shouldConnect}
                onClick={() =>
                  dispatch({
                    type: "SET_TRAINING",
                    payload: { practiceKind: "compose", replayCall: null },
                  })
                }
              >
                {PRACTICE_KIND_LABELS.compose}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={practiceKind === "replay" ? "primary" : "outline"}
                disabled={shouldConnect}
                onClick={() =>
                  dispatch({
                    type: "SET_TRAINING",
                    payload: { practiceKind: "replay" },
                  })
                }
              >
                {PRACTICE_KIND_LABELS.replay}
              </Button>
            </div>
            {practiceKind === "compose" && (
              <p className="text-[11px] text-fg3">
                Inventa un comprador con el comportamiento de los prospectos de esta
                oferta: mismas frases y situaciones, persona nueva.
              </p>
            )}
            {practiceKind === "replay" && (
              <div className="space-y-2">
                <p className="text-[11px] text-fg3">
                  El agente de voz es esa persona y esa llamada que no cerró. Tú intentas
                  cerrarla esta vez.
                </p>
                {openCalls.length === 0 ? (
                  <p className="text-[11px] text-destructive">
                    No hay llamadas abiertas de esta oferta. Sube o sincroniza
                    cierres que no se hayan cerrado.
                  </p>
                ) : (
                  <select
                    className="w-full rounded-md border border-separator1 bg-bg1 px-2 py-1.5 text-sm"
                    disabled={shouldConnect || loadingReplay}
                    value={
                      trainingState.training.replayCall
                        ? `${trainingState.training.replayCall.source}:${trainingState.training.replayCall.sourceId}`
                        : ""
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!value.includes(":")) return;
                      const [source, ...rest] = value.split(":");
                      if (source !== "fathom" && source !== "upload") return;
                      void selectReplay(source, rest.join(":"));
                    }}
                  >
                    <option value="">Elige la llamada…</option>
                    {openCalls.map((row) => (
                      <option
                        key={`${row.source}:${row.sourceId}`}
                        value={`${row.source}:${row.sourceId}`}
                      >
                        {row.leadName || row.title}
                        {row.result ? ` · ${row.result}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                {loadingReplay && (
                  <p className="text-[11px] text-fg3">Cargando esa llamada…</p>
                )}
                {trainingState.training.replayCall && (
                  <p className="text-[11px] text-fg2">
                    Recreando: {trainingState.training.replayCall.leadName ||
                      trainingState.training.replayCall.title}
                  </p>
                )}
              </div>
            )}
          </div>

          {!ready && (
            <p className="text-xs text-destructive">
              Para entrar a la reunión necesitas tu oferta y al menos una
              transcripción (archivo o grabación).
            </p>
          )}

          <FormField
            control={form.control}
            name="language"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Idioma del prospecto</FormLabel>
                <Select
                  disabled={shouldConnect}
                  onValueChange={field.onChange}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="voice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Voz del prospecto</FormLabel>
                <Select
                  disabled={shouldConnect}
                  onValueChange={field.onChange}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="max-h-60">
                    {voices.map((voice) => (
                      <SelectItem key={voice.id} value={voice.id}>
                        {voice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="difficulty"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Dificultad</FormLabel>
                <Select
                  disabled={shouldConnect}
                  onValueChange={field.onChange}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(Object.keys(DIFFICULTY_LABELS) as DifficultyLevel[]).map(
                      (key) => (
                        <SelectItem key={key} value={key}>
                          {DIFFICULTY_LABELS[key]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs">
                  El tipo de lead define si se va por las ramas o va al grano.
                  La dificultad es cuánto de lo útil (dinero, decisor, dolor)
                  se guarda, no si se calla.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="callSection"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Sección a practicar</FormLabel>
                <Select
                  disabled={shouldConnect}
                  onValueChange={field.onChange}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(Object.keys(CALL_SECTION_LABELS) as CallSection[]).map(
                      (key) => (
                        <SelectItem key={key} value={key}>
                          {CALL_SECTION_LABELS[key]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="space-y-2 rounded-xl border border-separator1 p-3">
            <Label>Meta de tiempo (opcional)</Label>
            <p className="text-[11px] text-fg3">
              El análisis dice si la cumpliste. Vacío = sin meta.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <MinuteField
                label="Total (min)"
                value={trainingState.training.timeGoal?.totalMin}
                disabled={shouldConnect}
                onChange={(value) =>
                  dispatch({
                    type: "SET_TRAINING",
                    payload: {
                      timeGoal: {
                        ...trainingState.training.timeGoal,
                        totalMin: value,
                      },
                    },
                  })
                }
              />
              {(callSection === "full" || callSection === "discovery") && (
                <MinuteField
                  label="Descubrimiento"
                  value={trainingState.training.timeGoal?.discoveryMin}
                  disabled={shouldConnect}
                  onChange={(value) =>
                    dispatch({
                      type: "SET_TRAINING",
                      payload: {
                        timeGoal: {
                          ...trainingState.training.timeGoal,
                          discoveryMin: value,
                        },
                      },
                    })
                  }
                />
              )}
              {(callSection === "full" ||
                callSection === "pitch" ||
                callSection === "pitch_close") && (
                <MinuteField
                  label="Presentación de la oferta"
                  value={trainingState.training.timeGoal?.pitchMin}
                  disabled={shouldConnect}
                  onChange={(value) =>
                    dispatch({
                      type: "SET_TRAINING",
                      payload: {
                        timeGoal: {
                          ...trainingState.training.timeGoal,
                          pitchMin: value,
                        },
                      },
                    })
                  }
                />
              )}
              {(callSection === "full" ||
                callSection === "close" ||
                callSection === "pitch_close") && (
                <MinuteField
                  label="Cierre"
                  value={trainingState.training.timeGoal?.closeMin}
                  disabled={shouldConnect}
                  onChange={(value) =>
                    dispatch({
                      type: "SET_TRAINING",
                      payload: {
                        timeGoal: {
                          ...trainingState.training.timeGoal,
                          closeMin: value,
                        },
                      },
                    })
                  }
                />
              )}
            </div>
          </div>

          {needsPitch && (
            <FormField
              control={form.control}
              name="pitchSummary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Resumen de la presentación (modo cierre)</FormLabel>
                  <FormControl>
                    <Textarea {...field} disabled={shouldConnect} rows={4} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {showBrief && trainingState.training.productName && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-fg2">
                  Perfil del prospecto
                </span>
                {practiceKind === "compose" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={shouldConnect}
                    onClick={() => dispatch({ type: "REGENERATE_PROSPECT" })}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Otro lead de esta oferta
                  </Button>
                )}
              </div>
              <ProspectBrief profile={trainingState.training.prospectProfile} />
            </div>
          )}
        </div>
      </form>
    </Form>
  );
}

function MinuteField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value?: number | null;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-fg3">{label}</Label>
      <Input
        type="number"
        min={1}
        max={90}
        disabled={disabled}
        value={value || ""}
        placeholder="—"
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (!raw) {
            onChange(null);
            return;
          }
          const next = Number(raw);
          onChange(Number.isFinite(next) && next > 0 ? next : null);
        }}
      />
    </div>
  );
}

function OfferGlance({ offer }: { offer: WorkspaceOffer }) {
  const glance = practiceOfferGlance(offer);
  const shownBonuses = glance.bonusNames.slice(0, 6);
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-pretty">{offer.productName}</p>
      {glance.blurb && (
        <p className="text-sm text-fg2 text-pretty">{glance.blurb}</p>
      )}
      {glance.prices.length > 0 && (
        <ul className="text-xs text-fg3 space-y-0.5">
          {glance.prices.map((line) => (
            <li key={line} className="text-pretty">{line}</li>
          ))}
        </ul>
      )}
      {glance.bonusCount > 0 && (
        <p className="text-xs text-fg3 text-pretty">
          {glance.bonusCount === 1 ? "1 bono" : `${glance.bonusCount} bonos`}
          {shownBonuses.length ? `: ${shownBonuses.join(", ")}` : ""}
          {glance.bonusCount > shownBonuses.length ? "…" : ""}
        </p>
      )}
    </div>
  );
}
