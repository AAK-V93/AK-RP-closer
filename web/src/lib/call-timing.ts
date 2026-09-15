import type { CallSection } from "@/data/training-session";

export type TalkPhase = "discovery" | "pitch" | "close" | "other";

export type TimeGoal = {
  totalMin?: number | null;
  discoveryMin?: number | null;
  pitchMin?: number | null;
  closeMin?: number | null;
};

export type PhaseSpan = {
  phase: TalkPhase;
  startSec: number;
  endSec: number;
};

export type TimingCheck = {
  label: string;
  targetSec: number;
  actualSec: number;
  met: boolean;
};

export type CallTiming = {
  totalSec: number;
  phases: Record<TalkPhase, number>;
  coverage:
    | "completa"
    | "descubrimiento"
    | "pitch"
    | "cierre"
    | "pitch_cierre"
    | "incompleta";
  intended: CallSection;
  goal: {
    set: boolean;
    met: boolean | null;
    checks: TimingCheck[];
  };
};

const EMPTY_PHASES = (): Record<TalkPhase, number> => ({
  discovery: 0,
  pitch: 0,
  close: 0,
  other: 0,
});

export function hasTimeGoal(goal?: TimeGoal | null) {
  if (!goal) return false;
  return Boolean(
    positive(goal.totalMin) ||
      positive(goal.discoveryMin) ||
      positive(goal.pitchMin) ||
      positive(goal.closeMin),
  );
}

export function formatClock(totalSec: number) {
  const sec = Math.max(0, Math.round(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatMinutes(sec: number) {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function positive(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function parsePhase(raw: unknown): TalkPhase {
  const value = String(raw || "").toLowerCase();
  if (value.includes("disc") || value.includes("descubr") || value === "discovery") {
    return "discovery";
  }
  if (value.includes("pitch") || value.includes("present")) return "pitch";
  if (value.includes("close") || value.includes("cierre")) return "close";
  return "other";
}

export function fallbackPhases(
  intended: CallSection,
  totalSec: number,
): Record<TalkPhase, number> {
  const phases = EMPTY_PHASES();
  const t = Math.max(0, totalSec);
  if (intended === "discovery") phases.discovery = t;
  else if (intended === "pitch") phases.pitch = t;
  else if (intended === "close") phases.close = t;
  else if (intended === "pitch_close") {
    phases.pitch = t * 0.55;
    phases.close = t * 0.45;
  } else {
    phases.discovery = t * 0.5;
    phases.pitch = t * 0.3;
    phases.close = t * 0.2;
  }
  return phases;
}

export function phasesFromSpans(
  spans: PhaseSpan[] | null | undefined,
  totalSec: number,
  intended: CallSection,
): Record<TalkPhase, number> {
  const phases = EMPTY_PHASES();
  if (!spans?.length) return fallbackPhases(intended, totalSec);
  for (const span of spans) {
    const dur = Math.max(0, Number(span.endSec) - Number(span.startSec));
    phases[parsePhase(span.phase)] += dur;
  }
  const sum = phases.discovery + phases.pitch + phases.close + phases.other;
  if (sum < 8) return fallbackPhases(intended, totalSec);
  const scale = totalSec > 0 ? totalSec / sum : 1;
  (Object.keys(phases) as TalkPhase[]).forEach((key) => {
    phases[key] = Math.round(phases[key] * scale);
  });
  return phases;
}

export function coverageFromPhases(
  phases: Record<TalkPhase, number>,
  intended: CallSection,
): CallTiming["coverage"] {
  const min = 20;
  const d = phases.discovery >= min;
  const p = phases.pitch >= min;
  const c = phases.close >= min;
  if (d && p && c) return "completa";
  if (p && c) return "pitch_cierre";
  if (d && !p && !c) return "descubrimiento";
  if (p && !d && !c) return "pitch";
  if (c && !d && !p) return "cierre";
  if (intended === "full" && (d || p || c)) return "incompleta";
  if (d) return "descubrimiento";
  if (p && c) return "pitch_cierre";
  if (p) return "pitch";
  if (c) return "cierre";
  return "incompleta";
}

function checkTarget(label: string, targetMin: number, actualSec: number): TimingCheck {
  const targetSec = targetMin * 60;
  const low = targetSec * 0.75;
  const high = targetSec * 1.35;
  return {
    label,
    targetSec,
    actualSec,
    met: actualSec >= low && actualSec <= high,
  };
}

export function buildCallTiming(args: {
  totalSec: number;
  intended: CallSection;
  spans?: PhaseSpan[] | null;
  goal?: TimeGoal | null;
}): CallTiming {
  const totalSec = Math.max(0, Math.round(args.totalSec));
  const phases = phasesFromSpans(args.spans, totalSec, args.intended);
  const checks: TimingCheck[] = [];
  const goal = args.goal;
  if (positive(goal?.totalMin)) {
    checks.push(checkTarget("Total", goal!.totalMin!, totalSec));
  }
  if (positive(goal?.discoveryMin)) {
    checks.push(checkTarget("Descubrimiento", goal!.discoveryMin!, phases.discovery));
  }
  if (positive(goal?.pitchMin)) {
    checks.push(checkTarget("Pitch", goal!.pitchMin!, phases.pitch));
  }
  if (positive(goal?.closeMin)) {
    checks.push(checkTarget("Cierre", goal!.closeMin!, phases.close));
  }
  return {
    totalSec,
    phases,
    coverage: coverageFromPhases(phases, args.intended),
    intended: args.intended,
    goal: {
      set: checks.length > 0,
      met: checks.length ? checks.every((item) => item.met) : null,
      checks,
    },
  };
}

export function parsePhaseSpans(raw: unknown): PhaseSpan[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = (item || {}) as Record<string, unknown>;
      return {
        phase: parsePhase(row.phase ?? row.name),
        startSec: Number(row.startSec ?? row.start ?? 0) || 0,
        endSec: Number(row.endSec ?? row.end ?? 0) || 0,
      };
    })
    .filter((span) => span.endSec > span.startSec);
}

export const COVERAGE_LABELS: Record<CallTiming["coverage"], string> = {
  completa: "Llamada completa (descubrimiento + pitch + cierre)",
  descubrimiento: "Solo descubrimiento",
  pitch: "Solo pitch",
  cierre: "Solo cierre",
  pitch_cierre: "Pitch + cierre",
  incompleta: "Incompleta — faltó alguna parte",
};
