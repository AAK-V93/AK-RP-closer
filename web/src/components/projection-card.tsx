"use client";

import { FormEvent, useState } from "react";
import { HelpNote, MetricCard, SectionHeading } from "@/components/metric-card";
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
      <section className="rounded-2xl border border-separator1 bg-bg1 p-5 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
          Meta de comisión
        </p>
        <h2 className="text-lg font-light">¿Cuánto quieres ganar de comisión este mes?</h2>
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

  return (
    <section className="space-y-4">
      <SectionHeading>Proyección del mes</SectionHeading>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Meta" value={money(projection.metaUsd)} tone="brand" />
        <MetricCard label="Ya asegurado" value={money(Math.round(projection.asegurada))} tone="brand" />
        <MetricCard
          label="Falta"
          value={money(Math.round(projection.falta))}
          tone={projection.falta > 0 ? "attention" : "muted"}
        />
      </div>
      <p className="text-sm text-fg1">{projection.todayAction}</p>
      <p className="text-sm text-fg3">
        Asegurado = comisión pendiente + saldos por cobrar.
        {projection.assumedRatesLabel ? ` ${projection.assumedRatesLabel}` : ""}
      </p>
      <HelpNote>
        <p>Ya asegurado es la comisión de lo que falta cobrar más la comisión de los saldos que el cliente todavía debe.</p>
        <p>Falta es la meta del mes menos eso. Si todavía hay pocas llamadas reales, las tasas de show y cierre son un supuesto y se dice en la línea de arriba.</p>
      </HelpNote>
    </section>
  );
}
