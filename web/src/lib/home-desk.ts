export function analyzeCardStatus(unclassified: number) {
  if (unclassified > 0) return `${unclassified} sin clasificar`;
  return "Todo al día";
}

export function followupCardStatus(today: number, overdue: number) {
  if (today <= 0 && overdue <= 0) return "Todo al día";
  const vencidos = overdue === 1 ? "1 vencido" : `${Math.max(0, overdue)} vencidos`;
  return `${Math.max(0, today)} hoy · ${vencidos}`;
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
