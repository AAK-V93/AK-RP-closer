export type TemperatureLevel = "alto" | "medio" | "bajo";

export type TemperatureInput = {
  enJuego: number;
  silenceDays: number;
  calificado: boolean | null;
  objectionOpen: boolean;
  decisionDate: boolean;
  intentos: number;
};

const RANK: Record<TemperatureLevel, number> = { alto: 3, medio: 2, bajo: 1 };

export function temperatureRank(level: TemperatureLevel) {
  return RANK[level];
}

export function leadTemperature(input: TemperatureInput): {
  level: TemperatureLevel;
  score: number;
} {
  let score = 0;
  if (input.enJuego >= 5000) score += 3;
  else if (input.enJuego >= 1000) score += 2;
  else if (input.enJuego > 0) score += 1;

  if (input.silenceDays <= 1) score += 2;
  else if (input.silenceDays <= 6) score += 1;
  else if (input.silenceDays >= 14) score -= 2;

  if (input.calificado) score += 2;
  if (input.objectionOpen) score -= 1;
  else if (input.calificado) score += 1;
  if (input.decisionDate) score += 2;
  if (input.intentos >= 3) score -= 1;

  const level: TemperatureLevel = score >= 5 ? "alto" : score >= 2 ? "medio" : "bajo";
  return { level, score };
}

export function temperatureAction(level: TemperatureLevel, recomendacion: string) {
  const tip = recomendacion.trim();
  if (tip) return tip.length > 140 ? `${tip.slice(0, 137)}…` : tip;
  if (level === "alto") return "Ataca ahora: hay intención y dinero en juego.";
  if (level === "medio") return "Retoma con un mensaje de valor.";
  return "Lleva días sin responder: llamada en frío o audio.";
}

export function scriptTemperatureFit(
  script: { type: string; recomendacion: string; key: string },
  level: TemperatureLevel | undefined,
) {
  if (!level) return 0;
  const blob = `${script.type} ${script.key} ${script.recomendacion}`.toLowerCase();
  const cold = /fr[ií]o|no contest|indiferenc|victima|víctima|desconfiado|podcast|audio/;
  const hot = /decisi|inscrip|pago|premonic|noticia|cierre/;
  if (level === "alto") {
    if (script.type === "DECISION" || script.type === "PAGO PENDIENTE") return 30;
    if (hot.test(blob)) return 18;
    if (cold.test(blob)) return -12;
  }
  if (level === "bajo") {
    if (cold.test(blob) || script.type === "RETOMAR") return 24;
    if (script.type === "DECISION") return -8;
  }
  if (level === "medio" && /valor|podcast|desconfiado/.test(blob)) return 12;
  return 0;
}

export function expectedTemperature(resultado: string): TemperatureLevel | null {
  if (resultado === "cerro") return "alto";
  if (resultado === "perdido") return "bajo";
  return null;
}
