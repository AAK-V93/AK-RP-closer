"use client";

import { useState, type ReactNode } from "react";

export type MetricTone = "attention" | "money" | "brand" | "muted";

const TONE_CLASS: Record<MetricTone, string> = {
  attention: "text-tone-attention",
  money: "text-tone-money",
  brand: "text-fg0",
  muted: "text-fg3",
};

export function MetricCard({
  label,
  value,
  tone = "brand",
}: {
  label: string;
  value: string;
  tone?: MetricTone;
}) {
  return (
    <div className="flex min-h-[112px] flex-col justify-between rounded-2xl bg-bg1 px-5 py-5">
      <p className="text-sm text-fg3">{label}</p>
      <p className={`text-[28px] font-medium leading-none tracking-tight ${TONE_CLASS[tone]}`}>{value}</p>
    </div>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-2 pt-4">
      <h2 className="text-sm text-fg3">{children}</h2>
      <div className="h-px bg-separator1" />
    </div>
  );
}

export function HelpNote({
  label = "¿Cómo funciona esto?",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="text-sm text-tone-info underline-offset-2 hover:underline"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div className="mt-3 space-y-2 rounded-2xl border border-separator1 bg-bg1 p-4 text-sm leading-relaxed text-fg2">
          {children}
        </div>
      )}
    </div>
  );
}
