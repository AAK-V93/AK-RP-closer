import { weekKey } from "@/lib/crm-filters";
import { compareFollowupRank, followupCalendarDay, followupRankInput } from "@/lib/crm-followups";
import { zonedDayKey } from "@/lib/crm-time";
import { countPhrase, plainStatus } from "@/lib/plain-labels";

export type CrmAskRow = {
  id: string;
  cliente: string;
  dueAt: string;
  tipo?: string;
  hilo?: string;
  paso?: string;
  ultimoToque?: string;
  proximaAccion?: string;
  canal?: string;
  telefono?: string;
  oferta?: string;
  mensajeSugerido?: string;
  enJuego?: number;
  temperatura?: string;
  acuerdo?: string;
  queHacer?: string;
  proximo?: string;
};

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function addDays(day: string, count: number) {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + count));
  return next.toISOString().slice(0, 10);
}

function shortDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${date} ${months[month - 1]}`;
}

function rowDay(row: CrmAskRow) {
  return followupCalendarDay({ proximo: row.proximo, dueAt: row.dueAt });
}

function bySharedRank(rows: CrmAskRow[], now: Date) {
  return [...rows].sort((a, b) =>
    compareFollowupRank(followupRankInput(a, now), followupRankInput(b, now)),
  );
}

function canalLabel(value?: string) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "WHATSAPP") return "WhatsApp";
  if (raw === "LLAMADA") return "Llamada";
  if (raw === "EMAIL") return "Email";
  if (!raw) return "";
  return plainStatus(raw);
}

function actionOf(row: CrmAskRow) {
  return row.proximaAccion || row.queHacer || row.acuerdo || "";
}

function pendingToday(row: CrmAskRow, today: string) {
  const due = rowDay(row);
  return /pendiente de hoy/i.test(actionOf(row)) || (Boolean(due) && due <= today);
}

function whenLabel(row: CrmAskRow, today: string) {
  const due = rowDay(row);
  if (pendingToday(row, today)) {
    return due < today ? `pendiente desde ${shortDay(due)}` : "hoy, pendiente";
  }
  if (due === today) return "hoy";
  if (due === addDays(today, 1)) return "mañana";
  return shortDay(due);
}

function howLabel(row: CrmAskRow) {
  const canal = canalLabel(row.canal);
  const action = actionOf(row);
  const phone = row.telefono?.trim();
  return [canal, action, phone].filter(Boolean).join(" · ");
}

function nameScore(cliente: string, question: string) {
  const q = fold(question);
  const name = fold(cliente).trim();
  if (name.length >= 3 && q.includes(name)) return name.length + 10;
  const words = new Set(q.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3));
  const tokens = name.split(/\s+/).filter((token) => token.length >= 3 && words.has(token));
  return tokens.reduce((sum, token) => sum + token.length, 0);
}

const NAME_STOP = new Set([
  "quien",
  "quienes",
  "como",
  "cuando",
  "hoy",
  "manana",
  "semana",
  "seguimiento",
  "seguimientos",
  "todos",
  "todas",
  "esto",
  "eso",
  "esa",
  "ese",
]);

function bestPeople(rows: CrmAskRow[], question: string) {
  const scored = rows
    .map((row) => ({ row, score: nameScore(row.cliente, question) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((item) => item.score === top).map((item) => item.row);
}

function trailingName(question: string) {
  const q = fold(question)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = q.match(/(?:^|\s)(?:a|de|con)\s+([\p{L}]{3,}(?:\s+[\p{L}]{3,}){0,2})$/u);
  if (!match) return "";
  const tokens = match[1].split(/\s+/);
  if (tokens.some((token) => NAME_STOP.has(token))) return "";
  return match[1];
}

function mentions(question: string, words: string[]) {
  const q = fold(question);
  return words.some((word) => q.includes(fold(word)));
}

function lineOf(row: CrmAskRow, today: string, money?: (value: number) => string) {
  const tipo = plainStatus(row.hilo || row.tipo);
  const paso = row.paso && row.paso !== "—" ? `paso ${row.paso}` : "";
  const juego = row.enJuego && money ? money(row.enJuego) : "";
  const head = [row.cliente, tipo, paso].filter(Boolean).join(" · ");
  const bits = [
    head,
    `Cuándo: ${whenLabel(row, today)}`,
    howLabel(row) ? `Cómo: ${howLabel(row)}` : "",
    juego ? `En juego: ${juego}` : "",
    row.ultimoToque ? `Último toque: ${row.ultimoToque}` : "",
    row.oferta ? `Oferta: ${row.oferta}` : "",
  ].filter(Boolean);
  return bits.join("\n");
}

function brief(row: CrmAskRow, today: string) {
  const tipo = plainStatus(row.hilo || row.tipo);
  return `• ${[row.cliente, tipo, whenLabel(row, today), howLabel(row)].filter(Boolean).join(" · ")}`;
}

export function answerCrmFollowups(
  rows: CrmAskRow[],
  question: string,
  opts?: { now?: Date; money?: (value: number) => string },
) {
  const now = opts?.now || new Date();
  const today = zonedDayKey(now);
  const asked = question.trim();
  if (!rows.length) return "No hay seguimientos abiertos en el CRM.";
  if (!asked) return "Pregunta a quién, cuándo o cómo.";

  const people = bestPeople(rows, asked);
  const wantsHow = mentions(asked, ["como", "mensaje", "que le digo", "que digo", "canal"]);
  const wantsWhen = mentions(asked, ["cuando", "fecha", "que dia", "para cuando"]);
  const wantsWho = mentions(asked, ["quien", "quienes", "a quien", "seguimiento", "pendiente", "toca"]);
  const todayOnly = mentions(asked, ["hoy", "pendiente de hoy", "vencid"]);
  const tomorrowOnly = mentions(asked, ["manana"]);
  const weekOnly = mentions(asked, ["esta semana", "semana"]);

  if (people.length === 1) {
    const row = people[0];
    const body = lineOf(row, today, opts?.money);
    if (wantsHow && row.mensajeSugerido?.trim()) {
      return `${body}\nMensaje: ${row.mensajeSugerido.trim()}`;
    }
    return body;
  }
  if (people.length > 1) {
    return `Hay más de uno con ese nombre:\n${people.map((row) => brief(row, today)).join("\n")}`;
  }

  const named = trailingName(asked);
  if (named) return `No tengo un seguimiento de ${named} en el CRM.`;

  const hasIntent = wantsHow || wantsWhen || wantsWho || todayOnly || tomorrowOnly || weekOnly;
  if (!hasIntent) {
    const due = bySharedRank(
      rows.filter((row) => pendingToday(row, today)),
      now,
    );
    if (!due.length) return "Pregunta a quién, cuándo o cómo. Hoy no toca ninguno.";
    return `Hoy toca ${countPhrase(due.length, "seguimiento", "seguimientos")}. Pregunta a quién, cuándo o cómo.\n${due
      .slice(0, 8)
      .map((row) => brief(row, today))
      .join("\n")}`;
  }

  let pool = rows;
  if (todayOnly) pool = rows.filter((row) => pendingToday(row, today));
  else if (tomorrowOnly) pool = rows.filter((row) => rowDay(row) === addDays(today, 1));
  else if (weekOnly) {
    const week = weekKey(today);
    pool = rows.filter((row) => weekKey(rowDay(row)) === week);
  }
  pool = bySharedRank(pool, now);

  if (!pool.length) {
    const next = bySharedRank(rows, now)[0];
    if (todayOnly && next) return `Hoy no toca ninguno. El próximo es ${next.cliente}, ${whenLabel(next, today)}.`;
    if (todayOnly) return "Hoy no toca ninguno.";
    if (tomorrowOnly) return "Mañana no hay seguimientos.";
    if (weekOnly) return "Esta semana no hay seguimientos.";
    return "No hay seguimientos con eso.";
  }

  const title = todayOnly
    ? `Hoy toca ${countPhrase(pool.length, "seguimiento", "seguimientos")}:`
    : tomorrowOnly
      ? `Mañana ${countPhrase(pool.length, "seguimiento", "seguimientos")}:`
      : weekOnly
        ? `Esta semana ${countPhrase(pool.length, "seguimiento", "seguimientos")}:`
        : `${countPhrase(pool.length, "seguimiento", "seguimientos")}:`;
  const shown = pool.slice(0, 12).map((row) => brief(row, today));
  const more = pool.length > 12 ? `\n… y ${pool.length - 12} más.` : "";
  return `${title}\n${shown.join("\n")}${more}`;
}
