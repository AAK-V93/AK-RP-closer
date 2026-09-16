"use client";

import { FormEvent, useState } from "react";
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
      <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
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
    <section className="rounded-2xl border border-separator1 bg-bg1 p-4 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
        Proyección del mes
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-fg3">Meta</p>
          <p>{money(projection.metaUsd)}</p>
        </div>
        <div>
          <p className="text-[11px] text-fg3">Ya asegurado</p>
          <p>{money(Math.round(projection.asegurada))}</p>
        </div>
        <div>
          <p className="text-[11px] text-fg3">Falta</p>
          <p>{money(Math.round(projection.falta))}</p>
        </div>
        <div>
          <p className="text-[11px] text-fg3">Hoy</p>
          <p>{projection.todayAction}</p>
        </div>
      </div>
      <p className="text-[11px] text-fg3">
        Asegurado = comisión pendiente + saldos por cobrar.
        {projection.assumedRatesLabel ? ` ${projection.assumedRatesLabel}` : ""}
      </p>
    </section>
  );
}
