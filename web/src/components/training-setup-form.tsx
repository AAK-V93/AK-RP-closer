"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { Textarea } from "@/components/ui/textarea";
import { useTraining } from "@/hooks/use-training-state";
import {
  CALL_SECTION_LABELS,
  DIFFICULTY_LABELS,
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
import { Badge } from "@/components/ui/badge";
import type { LeadPlaybook } from "@/lib/lead-playbook";

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
};

export function TrainingSetupForm() {
  const { trainingState, dispatch } = useTraining();
  const { shouldConnect } = useConnection();
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [offers, setOffers] = useState<WorkspaceOffer[]>([]);
  const [offer, setOffer] = useState<WorkspaceOffer | null>(null);
  const [ready, setReady] = useState(false);
  const [transcriptCount, setTranscriptCount] = useState(0);
  const [playbookReady, setPlaybookReady] = useState(false);

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

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => setServerReady(data.ready))
      .catch(() => setServerReady(false));
  }, []);

  useEffect(() => {
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((data) => {
        setOffers(data.offers || []);
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
              pitchSummary:
                form.getValues("pitchSummary") || data.offer.pitchSummary,
              leadPlaybook: (data.playbook as LeadPlaybook) || null,
            },
          });
          if (data.offer.pitchSummary && !form.getValues("pitchSummary")) {
            form.setValue("pitchSummary", data.offer.pitchSummary);
          }
        }
      })
      .catch(() => undefined);
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

  return (
    <Form {...form}>
      <form className="h-full flex flex-col">
        <div className="flex-shrink-0 py-4 px-1 border-b border-separator1">
          <div className="text-xs font-bold uppercase tracking-widest text-fg0">
            Configuración
          </div>
          {serverReady === false && (
            <p className="text-xs text-destructive mt-2">
              Configura GEMINI_API_KEY y LiveKit en .env.local
            </p>
          )}
          {serverReady === true && (
            <Badge variant="outline" className="mt-2 text-xs">
              Servicio listo
            </Badge>
          )}
        </div>

        <div className="flex-grow overflow-y-auto py-4 space-y-4">
          <div className="rounded-lg border border-separator1 bg-bg0 p-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg3">
              Tu oferta
            </p>
            {offers.length > 1 && (
              <select
                className="w-full rounded-md border border-separator1 bg-bg1 px-2 py-1.5 text-sm"
                value={offer?.id || ""}
                disabled={shouldConnect}
                onChange={(event) => {
                  const id = event.target.value;
                  fetch(`/api/workspace?offerId=${encodeURIComponent(id)}`)
                    .then((r) => r.json())
                    .then((data) => {
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
                    .catch(() => undefined);
                }}
              >
                {offers.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.productName}
                  </option>
                ))}
              </select>
            )}
            {offer ? (
              <>
                <p className="text-sm font-medium">{offer.productName}</p>
                <p className="text-xs text-fg3 line-clamp-4">
                  {offer.productDescription}
                </p>
                <p className="text-xs text-fg3">
                  {transcriptCount} llamadas en corpus
                  {playbookReady ? " · emulando tus leads" : ""}
                </p>
              </>
            ) : (
              <p className="text-xs text-fg3">
                Aún no hay oferta guardada.
              </p>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href="/setup">
                {ready ? "Editar oferta y llamadas" : "Subir oferta y llamadas"}
              </Link>
            </Button>
          </div>

          {!ready && (
            <p className="text-xs text-destructive">
              Para entrar a la reunión necesitas tu oferta y al menos una
              transcripción (archivo o Fathom).
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
                        {voice.name} — {voice.characteristic}
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
                  Qué tan colaborativo llega el lead. El personaje sale de tus
                  llamadas reales, no de una oferta inventada.
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

          {needsPitch && (
            <FormField
              control={form.control}
              name="pitchSummary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Resumen del pitch (modo cierre)</FormLabel>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={shouldConnect}
                  onClick={() => dispatch({ type: "REGENERATE_PROSPECT" })}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Regenerar
                </Button>
              </div>
              <ProspectBrief profile={trainingState.training.prospectProfile} />
            </div>
          )}
        </div>
      </form>
    </Form>
  );
}
