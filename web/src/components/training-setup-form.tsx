"use client";

import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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
import { RefreshCw, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  OFFER_CASES,
  OFFER_OTHER_ID,
  getOfferCase,
} from "@/data/offer-cases";

const schema = z.object({
  offerId: z.string().min(1, "Elige un tipo de oferta"),
  productName: z.string().min(2, "Mínimo 2 caracteres"),
  productDescription: z.string().min(10, "Describe tu producto (mín. 10 caracteres)"),
  difficulty: z.enum(["easy", "medium", "hard"]),
  callSection: z.enum(["full", "discovery", "pitch", "close", "pitch_close"]),
  language: z.enum(["es", "en", "pt", "fr"]),
  voice: z.nativeEnum(VoiceId),
  pitchSummary: z.string().optional(),
});

export function TrainingSetupForm() {
  const { trainingState, dispatch } = useTraining();
  const { shouldConnect } = useConnection();
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [parsingDoc, setParsingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      offerId: "",
      productName: trainingState.training.productName,
      productDescription: trainingState.training.productDescription,
      difficulty: trainingState.training.difficulty,
      callSection: trainingState.training.callSection,
      language: trainingState.training.language,
      voice: trainingState.sessionConfig.voice,
      pitchSummary: trainingState.training.pitchSummary || "",
    },
  });

  const callSection = form.watch("callSection");
  const offerId = form.watch("offerId");
  const selectedOffer = getOfferCase(offerId);
  const isOther = offerId === OFFER_OTHER_ID;
  const showBrief = shouldShowProspectBrief(callSection);
  const needsPitch = requiresPitchSummary(callSection);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => setServerReady(data.ready))
      .catch(() => setServerReady(false));
  }, []);

  useEffect(() => {
    const subscription = form.watch((values) => {
      dispatch({
        type: "SET_TRAINING",
        payload: {
          productName: values.productName || "",
          productDescription: values.productDescription || "",
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
          <FormField
            control={form.control}
            name="offerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Oferta a practicar</FormLabel>
                <Select
                  disabled={shouldConnect}
                  onValueChange={(id) => {
                    field.onChange(id);
                    const preset = getOfferCase(id);
                    if (preset) {
                      form.setValue("productName", preset.productName, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      form.setValue(
                        "productDescription",
                        preset.productDescription,
                        { shouldDirty: true, shouldValidate: true },
                      );
                      form.setValue("pitchSummary", preset.pitchSummary, {
                        shouldDirty: true,
                      });
                    } else if (id === OFFER_OTHER_ID) {
                      form.setValue("productName", "", { shouldDirty: true });
                      form.setValue("productDescription", "", {
                        shouldDirty: true,
                      });
                      form.setValue("pitchSummary", "", { shouldDirty: true });
                    }
                  }}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Elige un caso típico" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {OFFER_CASES.map((offer) => (
                      <SelectItem key={offer.id} value={offer.id}>
                        {offer.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={OFFER_OTHER_ID}>Otra oferta…</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs">
                  Casos listos para practicar. Si no está, elige Otra oferta.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedOffer && (
            <div className="p-3 rounded-lg bg-bg0 border border-separator1 space-y-1">
              <p className="text-sm font-medium">{selectedOffer.productName}</p>
              <p className="text-xs text-fg3">{selectedOffer.tagline}</p>
              <p className="text-xs text-fg2 pt-1">{selectedOffer.productDescription}</p>
            </div>
          )}

          {isOther && (
            <>
              <FormField
                control={form.control}
                name="productName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre de tu oferta</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        disabled={shouldConnect || parsingDoc}
                        placeholder="Ej: Mentoría Scale Pro"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="productDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Qué vendes</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        disabled={shouldConnect || parsingDoc}
                        rows={4}
                        placeholder="Qué incluye, a quién ayuda, ticket, resultado..."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-1">
                <FormLabel>O sube un one-pager</FormLabel>
                <label className="flex items-center gap-2 text-xs text-fg2 cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>
                    {parsingDoc ? "Leyendo documento…" : "PDF, TXT o MD (máx. 4 MB)"}
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.txt,.md,application/pdf,text/plain"
                    disabled={shouldConnect || parsingDoc}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      setDocError(null);
                      setParsingDoc(true);
                      try {
                        const body = new FormData();
                        body.append("file", file);
                        const response = await fetch("/api/offer-from-doc", {
                          method: "POST",
                          body,
                        });
                        const data = await response.json();
                        if (!response.ok) {
                          throw new Error(data.error || "No se pudo leer");
                        }
                        form.setValue("productName", data.productName || "");
                        form.setValue(
                          "productDescription",
                          data.productDescription || "",
                        );
                        form.setValue("pitchSummary", data.pitchSummary || "");
                      } catch (error) {
                        setDocError(
                          error instanceof Error
                            ? error.message
                            : "No se pudo leer el documento",
                        );
                      } finally {
                        setParsingDoc(false);
                      }
                    }}
                  />
                </label>
                {docError && (
                  <p className="text-xs text-destructive">{docError}</p>
                )}
              </div>
            </>
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
                <FormDescription className="text-xs">
                  El prospecto hablará y responderá en este idioma.
                </FormDescription>
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
                <FormLabel>Dificultad del prospecto</FormLabel>
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
                <FormDescription className="text-xs">
                  {callSection === "close" &&
                    "Recomendado: usa Pitch + cierre. Si solo cierre, pega el pitch abajo."}
                  {callSection === "pitch" &&
                    "Verás el perfil del prospecto ya descubierto."}
                </FormDescription>
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
                  <FormLabel>Resumen del pitch (para modo cierre)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      disabled={shouldConnect}
                      rows={4}
                      placeholder="Qué ya le explicaste al prospecto sobre el programa..."
                    />
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
