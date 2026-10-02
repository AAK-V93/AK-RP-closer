export const PRACTICE_QA_STORAGE_KEY = "closer-practice-qa";

export type PracticeErrorKind = "mic" | "connection";

export type PracticeStageTiming = { stage: string; ms: number };

function qaParam(search: string) {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(query).get("qa");
}

/** `?qa=1` turns the flag on. `?qa=0` turns it off. Anything else leaves it. */
export function practiceQaStorageAction(search: string): "set" | "clear" | null {
  const qa = qaParam(search);
  if (qa === "1") return "set";
  if (qa === "0") return "clear";
  return null;
}

/** `?qa=1` or localStorage. Normal visits stay on the real microphone. */
export function isPracticeQaRequest(search: string, stored: string | null) {
  const qa = qaParam(search);
  if (qa === "1") return true;
  if (qa === "0") return false;
  return stored === "1";
}

export function practiceErrorTitle(kind: PracticeErrorKind) {
  return kind === "mic" ? "Falta el micrófono" : "Error de conexión";
}

export function micHowToFix() {
  return "Conecta un micrófono, o permite el micrófono en el candado de la barra de direcciones, y vuelve a entrar.";
}

const STAGE_LABELS: Record<string, string> = {
  mic: "mic",
  preparing: "preparar",
  token: "token",
  audio: "sala",
  sala: "sala",
  agente: "agente",
  voz: "voz",
  ready: "listo",
  timeout: "tope",
};

export function formatPracticeTimings(rows: PracticeStageTiming[]) {
  return rows
    .map((row) => `${STAGE_LABELS[row.stage] || row.stage} ${(row.ms / 1000).toFixed(1)}s`)
    .join(" · ");
}

export function sumPracticeTimings(rows: PracticeStageTiming[]) {
  return rows.reduce((sum, row) => sum + Math.max(0, row.ms), 0);
}

/**
 * agente is room-connected → agent participant (0 when the participant is already
 * in the room at Connected). voz is that moment → first remote audio playing.
 * The on-screen clock is voiceAt - clickAt, not a clock that starts at "live".
 */
export function practiceConnectSpans(marks: {
  clickAt: number;
  micAt: number;
  tokenAt: number;
  roomAt: number;
  agentAt: number;
  voiceAt: number;
}) {
  return {
    stages: [
      { stage: "mic", ms: Math.max(0, marks.micAt - marks.clickAt) },
      { stage: "token", ms: Math.max(0, marks.tokenAt - marks.micAt) },
      { stage: "sala", ms: Math.max(0, marks.roomAt - marks.tokenAt) },
      { stage: "agente", ms: Math.max(0, marks.agentAt - marks.roomAt) },
      { stage: "voz", ms: Math.max(0, marks.voiceAt - marks.agentAt) },
    ],
    elapsedMs: Math.max(0, marks.voiceAt - marks.clickAt),
  };
}
