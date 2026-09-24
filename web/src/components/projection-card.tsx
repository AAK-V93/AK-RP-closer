"use client";

import { FormEvent, useState } from "react";
import { HelpNote } from "@/components/metric-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { moneyLabel } from "@/lib/crm-operacion";
import type { CommissionProjection } from "@/lib/crm-projection";

export function ProjectionCard({
  projection,
  needsGoal,
  onSaveGoal,
  saving,
  currency = "USD",
}: {
  projection: CommissionProjection | null;
  needsGoal?: boolean;
  onSaveGoal?: (usd: number) => Promise<void> | void;
  saving?: boolean;
  currency?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitGoal = async (event: FormEvent) => {
    event.preventDefault();
    const n = Number(draft.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n < 100) {
      setError("Pon un número (mínimo 100).");
      return;
    }
    setError(null);
    await onSaveGoal?.(Math.round(n));
  };

  if (needsGoal && onSaveGoal) {
    return (
      <section className="space-y-4">
        <h2 className="font-display text-3xl text-fg0">¿Cuánto quieres ganar de comisión este mes?</h2>
        <form onSubmit={submitGoal} className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <Input
              inputMode="numeric"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ej. 5000"
            />
          </div>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Guardando…" : "Guardar meta"}
          </Button>
        </form>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-[11px] text-fg3">También la puedes cambiar por chat.</p>
      </section>
    );
  }

  if (!projection) return null;

  const money = (value: number) => moneyLabel(value, currency);

  const covered = projection.falta <= 0;

  return (
    <section className="space-y-6">
      <div className="rounded-2xl bg-bg1 px-6 py-8">
        <p className="text-sm text-fg3">Falta para la meta</p>
        <p className={`font-display mt-2 text-6xl leading-none ${covered ? "text-tone-money" : "text-tone-attention"}`}>
          {money(Math.round(projection.falta))}
        </p>
        <p className="mt-4 text-sm text-fg3">
          Meta {money(projection.metaUsd)}. Ya asegurado {money(Math.round(projection.asegurada))}.
        </p>
      </div>
      {projection.todayAction && <p className="text-base text-fg0">{projection.todayAction}</p>}
      {projection.assumedRatesLabel && <p className="text-sm text-fg3">{projection.assumedRatesLabel}</p>}
      <HelpNote>
        <p>Ya asegurado es la comisión de lo que falta cobrar más la comisión de los saldos que el cliente todavía debe.</p>
        <p>Falta es la meta del mes menos eso. Si todavía hay pocas llamadas reales, las tasas de show y cierre son un supuesto y se dice en la línea de arriba.</p>
      </HelpNote>
    </section>
  );
}
