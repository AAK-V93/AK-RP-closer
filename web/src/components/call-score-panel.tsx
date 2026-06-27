"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, TrendingUp, Target, Lightbulb } from "lucide-react";
import { RUBRIC_CRITERIA } from "@/data/rubric";

export interface CallEvaluation {
  overallScore: number;
  criteria: {
    id: string;
    label: string;
    score: number;
    maxScore: number;
    feedback: string;
  }[];
  strengths: string[];
  improvements: string[];
  coachingTips: string[];
}

interface CallScorePanelProps {
  evaluation: CallEvaluation | null;
  isLoading: boolean;
  onClose: () => void;
}

export function CallScorePanel({
  evaluation,
  isLoading,
  onClose,
}: CallScorePanelProps) {
  if (isLoading) {
    return (
      <Card className="border-separator1 bg-bg1">
        <CardContent className="py-8 text-center text-sm text-fg2">
          Evaluando tu llamada según la rúbrica...
        </CardContent>
      </Card>
    );
  }

  if (!evaluation) return null;

  const criticalIds = new Set(
    RUBRIC_CRITERIA.filter((c) => c.critical).map((c) => c.id),
  );

  return (
    <Card className="border-separator1 bg-bg1 max-h-[70vh] overflow-y-auto">
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div>
          <CardTitle className="text-lg">Score de la llamada</CardTitle>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-3xl font-bold text-primary">
              {Math.round(evaluation.overallScore)}
            </span>
            <span className="text-sm text-fg3">/ 100</span>
          </div>
          <Progress value={evaluation.overallScore} className="mt-2 h-2" />
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-6 text-sm">
        <section>
          <h3 className="font-semibold flex items-center gap-2 mb-2">
            <Target className="h-4 w-4" />
            Criterios evaluados
          </h3>
          <div className="space-y-2">
            {evaluation.criteria.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-1 p-2 rounded-lg bg-bg0 border border-separator1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {c.id.toUpperCase()}: {c.label}
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
