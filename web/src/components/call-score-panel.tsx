"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, TrendingUp, Target, Lightbulb, User, MessageSquareWarning, Link2 } from "lucide-react";
import { RUBRIC_CRITERIA } from "@/data/rubric";
import { CallEvaluation } from "@/data/evaluation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type { CallEvaluation };

interface CallScorePanelProps {
  evaluation: CallEvaluation | null;
  isLoading: boolean;
  onClose?: () => void;
}

export function CallScorePanel({
  evaluation,
  isLoading,
  onClose,
}: CallScorePanelProps) {
  const { status } = useSession();

  if (isLoading) {
    return (
      <Card className="border-separator1 bg-bg1">
        <CardContent className="py-8 text-center text-sm text-fg2">
          Armando el reporte: ficha, objeciones y si usaste el descubrimiento...
        </CardContent>
      </Card>
    );
  }

  if (!evaluation) return null;

  const criticalIds = new Set(
    RUBRIC_CRITERIA.filter((c) => c.critical).map((c) => c.id),
  );
  const file = evaluation.prospectFile;

  return (
    <Card className={cn(
      "border-separator1 bg-bg1",
      onClose ? "max-h-[70vh] overflow-y-auto" : "",
    )}>
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div>
          <CardTitle className="text-lg">Reporte de la llamada</CardTitle>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-3xl font-bold text-primary">
              {Math.round(evaluation.overallScore)}
            </span>
            <span className="text-sm text-fg3">/ 100</span>
          </div>
          <Progress value={evaluation.overallScore} className="mt-2 h-2" />
          {evaluation.outcomeSummary && (
            <p className="text-sm text-fg2 mt-3">{evaluation.outcomeSummary}</p>
          )}
          {evaluation.saved ? (
            <p className="text-xs text-fg3 mt-2">
              Guardado en{" "}
              <Link href="/coach" className="underline">
                tu coaching
              </Link>
              .
            </p>
          ) : status === "unauthenticated" ? (
            <div className="text-xs text-fg3 mt-2 space-y-1">
              <p>
                Esta fue tu práctica gratis. Para la siguiente,{" "}
                <Link
                  href="/login?mode=register&reason=free-used&callbackUrl=/practicar"
                  className="underline"
                >
                  crea una cuenta
                </Link>
                .
              </p>
              <p>
                Si entras ahora, también puedes guardar este reporte en tu
                coaching.
              </p>
            </div>
          ) : null}
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-6 text-sm">
        {file && (
          <section>
            <h3 className="font-semibold flex items-center gap-2 mb-2">
              <User className="h-4 w-4" />
              Ficha del prospecto
            </h3>
            <div className="space-y-2 p-3 rounded-lg bg-bg0 border border-separator1">
              <p><span className="text-fg3">Dolor:</span> {file.pain}</p>
              <p><span className="text-fg3">Deseo:</span> {file.desire}</p>
              <p><span className="text-fg3">Urgencia:</span> {file.urgency}</p>
              {file.moneySignals && (
                <p><span className="text-fg3">Dinero:</span> {file.moneySignals}</p>
              )}
              {file.decisionContext && (
                <p><span className="text-fg3">Decisión:</span> {file.decisionContext}</p>
              )}
              {file.quotes?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {file.quotes.map((q, i) => (
                    <li key={i} className="text-xs italic text-fg2">«{q}»</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        <section>
          <h3 className="font-semibold flex items-center gap-2 mb-2">
            <Target className="h-4 w-4" />
            Criterios
          </h3>
          <div className="space-y-2">
            {evaluation.criteria.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-1 p-2 rounded-lg bg-bg0 border border-separator1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {c.label}
                    {criticalIds.has(c.id) && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        clave
                      </Badge>
                    )}
                  </span>
                  <span className="text-fg2">
                    {c.score}/{c.maxScore}
                  </span>
                </div>
                <p className="text-xs text-fg3">{c.feedback}</p>
              </div>
            ))}
          </div>
        </section>

        {evaluation.objections?.length > 0 && (
          <section>
            <h3 className="font-semibold flex items-center gap-2 mb-2">
              <MessageSquareWarning className="h-4 w-4" />
              Objeciones
            </h3>
            <div className="space-y-3">
              {evaluation.objections.map((o, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg bg-bg0 border border-separator1 space-y-1"
                >
                  <div className="flex flex-wrap gap-2 items-center">
                    <Badge variant="outline">{o.category}</Badge>
                    <span className="text-xs italic text-fg2">«{o.quote}»</span>
                  </div>
                  <p><span className="text-fg3">Raíz:</span> {o.realRoot}</p>
                  <p><span className="text-fg3">Cómo se gestionó:</span> {o.howHandled}</p>
                  <p><span className="text-fg3">Por qué falló o funcionó:</span> {o.whyFailedOrWorked}</p>
                  {o.suggestedLine && (
                    <p className="mt-2 p-2 rounded bg-primary/5 border border-primary/20 text-fg2">
                      <span className="text-fg3">Frase sugerida: </span>
                      {o.suggestedLine}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {evaluation.discoveryGaps?.length > 0 && (
          <section>
            <h3 className="font-semibold flex items-center gap-2 mb-2">
              <Link2 className="h-4 w-4" />
              Huecos de descubrimiento que alimentaron objeciones
            </h3>
            <div className="space-y-3">
              {evaluation.discoveryGaps.map((g, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg bg-bg0 border border-separator1 space-y-1"
                >
                  <p><span className="text-fg3">Qué se perdió:</span> {g.whatWasMissed}</p>
                  <p><span className="text-fg3">Cómo alimentó la objeción:</span> {g.howItFedObjection}</p>
                  {g.suggestedQuestion && (
                    <p className="text-fg2 italic">«{g.suggestedQuestion}»</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {evaluation.strengths.length > 0 && (
          <section>
            <h3 className="font-semibold flex items-center gap-2 mb-2 text-green-600">
              <TrendingUp className="h-4 w-4" />
              Fortalezas
            </h3>
            <ul className="list-disc pl-5 space-y-1 text-fg2">
              {evaluation.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </section>
        )}

        {evaluation.improvements.length > 0 && (
          <section>
            <h3 className="font-semibold mb-2">Áreas de mejora</h3>
            <ul className="list-disc pl-5 space-y-1 text-fg2">
              {evaluation.improvements.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </section>
        )}

        {evaluation.coachingTips.length > 0 && (
          <section>
            <h3 className="font-semibold flex items-center gap-2 mb-2">
              <Lightbulb className="h-4 w-4" />
              Consejos para la próxima práctica
            </h3>
            <ul className="space-y-2">
              {evaluation.coachingTips.map((tip, i) => (
                <li
                  key={i}
                  className="p-2 rounded-lg bg-primary/5 border border-primary/20 text-fg2"
                >
                  {tip}
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
