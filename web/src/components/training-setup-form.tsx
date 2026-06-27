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
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const schema = z.object({
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

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
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
            name="productName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Producto que vendes</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={shouldConnect}
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
                <FormLabel>Descripción del producto</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    disabled={shouldConnect}
                    rows={3}
                    placeholder="Qué incluye, a quién ayuda, resultado principal..."
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

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
