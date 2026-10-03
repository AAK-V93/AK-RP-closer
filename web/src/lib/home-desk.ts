import { closerSpanish } from "@/lib/closer-spanish";

export function analyzeCardStatus(unclassified: number) {
  if (unclassified > 0) return `${unclassified} sin clasificar`;
  return "Todo al día";
}

export function followupCardStatus(today: number, overdue: number) {
  const dueToday = Math.max(0, today);
  const late = Math.max(0, overdue);
  if (dueToday <= 0 && late <= 0) return "Todo al día";
  if (dueToday <= 0) return late === 1 ? "1 vencido" : `${late} vencidos`;
  if (late <= 0) return dueToday === 1 ? "1 pendiente de hoy" : `${dueToday} pendientes de hoy`;
  return `${dueToday} pendiente${dueToday === 1 ? "" : "s"} de hoy · ${late} vencido${late === 1 ? "" : "s"}`;
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

/** First-paint fallback until the light practice endpoint returns a drill. */
export function practiceCardFromGuides(guides: { drills?: string[]; ready?: boolean }[]) {
  const drill = closerSpanish(
    guides.flatMap((guide) => guide.drills || []).find((item) => item.trim()) || "",
  ).trim();
  return {
    practiceHref: drill ? `/practicar?focus=${encodeURIComponent(drill)}` : "/practicar",
    practiceStatus: drill || "Elige con quién practicar",
    newPattern: guides.some((guide) => Boolean(guide.ready)),
  };
}
