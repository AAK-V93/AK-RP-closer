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
