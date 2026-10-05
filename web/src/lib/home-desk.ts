import { closerSpanish } from "@/lib/closer-spanish";

export function analyzeCardStatus(unclassified: number) {
  if (unclassified > 0) return `${unclassified} sin clasificar`;
  return "Todo al día";
}

export function followupCardStatus(today: number, overdue: number) {
  const dueToday = Math.max(0, today);
  const late = Math.max(0, overdue);
  if (dueToday <= 0 && late <= 0) return "Todo al día";
  if (dueToday <= 0) return late === 1 ? "1 atrasado" : `${late} atrasados`;
  if (late <= 0) return dueToday === 1 ? "1 pendiente de hoy" : `${dueToday} pendientes de hoy`;
  return `${dueToday} pendiente${dueToday === 1 ? "" : "s"} de hoy · ${late} atrasado${late === 1 ? "" : "s"}`;
}

export function coachCardStatus(args: {
  newPattern: boolean;
  analyzedThisWeek: number;
}) {
  if (args.newPattern) return "Nuevo patrón detectado";
  if (args.analyzedThisWeek > 0) {
    const n = args.analyzedThisWeek;
    return `${n} llamada${n === 1 ? "" : "s"} analizada${n === 1 ? "" : "s"} esta semana`;
  }
  return "Sin novedades";
}

/** «Pierdes cierres cuando te dicen “…”». A raw objection becomes that sentence. */
export function patternSentence(raw: string) {
  const clean = closerSpanish(String(raw || ""))
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  if (/^pierdes cierres cuando te dicen\b/i.test(clean)) {
    return clean.charAt(0).toLocaleUpperCase("es") + clean.slice(1);
  }
  const quote = clean.replace(/^["“«']+|["”»']+$/g, "").trim();
  if (quote.length < 4) return "";
  return `Pierdes cierres cuando te dicen “${quote}”`;
}

/** First-paint fallback until the light practice endpoint returns a drill. */
export function practiceCardFromGuides(
  guides: { drills?: string[]; missingInLosses?: string[]; note?: string; ready?: boolean }[],
) {
  const drill = closerSpanish(
    guides.flatMap((guide) => guide.drills || []).find((item) => item.trim()) || "",
  ).trim();
  const pattern = patternSentence(
    guides.flatMap((guide) => guide.missingInLosses || []).find((item) => item.trim()) || "",
  );
  return {
    practiceHref: drill ? `/practicar?focus=${encodeURIComponent(drill)}` : "/practicar",
    practiceStatus: drill || "Elige con quién practicar",
    /** The exercise the practice room focuses on. */
    drill,
    /** The sentence on «Lo que más te frena». Empty hides the card. */
    pattern,
    newPattern: guides.some((guide) => Boolean(guide.ready)),
  };
}
