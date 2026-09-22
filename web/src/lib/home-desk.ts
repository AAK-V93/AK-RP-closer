export function analyzeCardStatus(unclassified: number) {
  if (unclassified > 0) return `${unclassified} sin clasificar`;
  return "Todo al día";
}

export function followupCardStatus(today: number, overdue: number) {
  const pending = Math.max(0, today) + Math.max(0, overdue);
  if (pending <= 0) return "Todo al día";
  return pending === 1 ? "1 pendiente de hoy" : `${pending} pendientes de hoy`;
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
