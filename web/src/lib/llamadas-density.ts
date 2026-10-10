import { realClientName } from "@/lib/crm-noise";
import { formatBogotaDay, zonedDayKey, zonedMonthRange, zonedWeekRange } from "@/lib/crm-time";
import { personLikeTitle, readableTitle } from "@/lib/plain-labels";

/** Default history length. A week longer than this stays behind «Ver todas». */
export const HISTORY_CAP = 10;

export type HistoryScope = "semana" | "mes" | "todas";

function dayKeyOf(value?: string | null) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return zonedDayKey(date);
  }
  return "";
}

const TITLE_DAY = /\b(\d{1,2}\s+[a-záéíóúñ]+(?:\s+\d{4})?)/i;

/**
 * The name the closer recognizes. A stored lead beats «Llamada del 28 sep, 11:04».
 * With no name, say so: «Sin nombre · 28 sep». Do not invent a person.
 */
export function pendingHeading(
  row: { leadName?: string | null; title?: string | null; date?: string | null },
  now = new Date(),
) {
  const lead = realClientName(row.leadName);
  if (lead && !/^llamada del\b/i.test(lead) && !/^sin nombre\b/i.test(lead)) return readableTitle(lead);
  const fromTitle = personLikeTitle(row.title);
  if (fromTitle) return readableTitle(fromTitle);
  const fromDate = formatBogotaDay(row.date, now);
  if (fromDate) return `Sin nombre · ${fromDate}`;
  const titled = String(row.title || "").match(TITLE_DAY);
  if (titled && /llamada del\b/i.test(String(row.title || ""))) return `Sin nombre · ${titled[1]}`;
  if (!String(row.title || "").trim()) return "Sin nombre";
  return readableTitle(row.title);
}

export type ConfirmChip = { label: string; field: string; value: string };

const FOLLOWUP_KINDS = ["Segunda reunión", "Pago", "Decisión", "Retomar"];
const AGENDA_KINDS = ["Asistió", "No asistió", "Reprogramó", "Acordó sin pago", "Cerró"];

function namedLead(value?: string | null) {
  const lead = realClientName(value);
  if (!lead || /^sin nombre\b/i.test(lead) || /^llamada del\b/i.test(lead)) return "";
  return lead;
}

function isYesNo(options: string[]) {
  return (
    options.length > 0 &&
    options.every((label) => /^(s[ií],?\s*qued[oó] seguimiento|no qued[oó])$/i.test(label))
  );
}

function declineChip(field = "requiere_seguimiento"): ConfirmChip {
  return { label: "No quedó", field, value: "No quedó" };
}

function followupChips(): ConfirmChip[] {
  return [
    ...FOLLOWUP_KINDS.map((label) => ({ label, field: "tipo_seguimiento", value: label })),
    declineChip(),
  ];
}

function isFollowupKindLabel(label: string) {
  const folded = label.toLocaleLowerCase("es");
  return FOLLOWUP_KINDS.some((kind) => kind.toLocaleLowerCase("es") === folded);
}

/** A named lead always gets «No quedó» on the follow-up kind set. */
function withDecline(chips: ConfirmChip[], named: boolean): ConfirmChip[] {
  if (!named || chips.length === 0) return chips;
  if (chips.some((chip) => /^no qued[oó]/i.test(chip.label))) return chips;
  if (!chips.every((chip) => isFollowupKindLabel(chip.label))) return chips;
  return [...chips, declineChip()];
}

/**
 * One tap for the question in front of the closer.
 * A name or an amount stays a text field. Sale yes/no only when that is the question.
 */
export function pendingPromptActions(item: {
  field?: string | null;
  options?: string[] | null;
  showToggle?: boolean;
  leadName?: string | null;
}): { chips: ConfirmChip[]; sale: boolean; when: boolean; freeText: boolean } {
  const field = String(item.field || "");
  const options = (item.options || []).map((option) => String(option || "").trim()).filter(Boolean);
  const named = Boolean(namedLead(item.leadName));
  if (field === "proximo_seguimiento") {
    return { chips: [], sale: false, when: true, freeText: false };
  }
  if (field === "venta_total" || field === "cash_collected") {
    return { chips: [], sale: false, when: false, freeText: true };
  }
  // Dennis, Leonardo, José Mauricio (sí/no) and Yajaira (caja vacía) get the same one tap.
  if (
    named &&
    (field === "requiere_seguimiento" || isYesNo(options) || (field === "revision" && options.length === 0))
  ) {
    return { chips: followupChips(), sale: false, when: false, freeText: false };
  }
  if (options.length > 0 && field) {
    return {
      chips: withDecline(
        options.map((label) =>
          /^no qued[oó]/i.test(label)
            ? declineChip(field === "tipo_seguimiento" ? "requiere_seguimiento" : field)
            : { label, field, value: label },
        ),
        named,
      ),
      sale: false,
      when: false,
      freeText: false,
    };
  }
  if (field === "tipo_seguimiento") {
    return {
      chips: withDecline(
        FOLLOWUP_KINDS.map((label) => ({ label, field, value: label })),
        named,
      ),
      sale: false,
      when: false,
      freeText: false,
    };
  }
  if (field === "requiere_seguimiento") {
    return {
      chips: [
        { label: "Sí, quedó seguimiento", field, value: "Sí, quedó seguimiento" },
        { label: "No quedó", field, value: "No quedó" },
      ],
      sale: false,
      when: false,
      freeText: false,
    };
  }
  if (field === "estado_agenda") {
    return {
      chips: AGENDA_KINDS.map((label) => ({ label, field, value: label })),
      sale: false,
      when: false,
      freeText: false,
    };
  }
  const asksName = field === "cliente_real";
  const unnamed = !realClientName(item.leadName);
  const sale = Boolean(item.showToggle) || (asksName && unnamed);
  let freeText = asksName || field === "revision" || field === "modo_pago";
  if (!sale && !freeText) freeText = true;
  return { chips: [], sale, when: false, freeText };
}

/**
 * This week, capped at 10. The month filter shows that month.
 * An empty week falls back to the 10 most recent so the page is not blank.
 */
export function sliceCallHistory<T extends { date?: string | null }>(
  rows: T[],
  scope: HistoryScope,
  now = new Date(),
): { visible: T[]; hidden: number; fallback: boolean } {
  const sorted = [...rows].sort((a, b) => dayKeyOf(b.date).localeCompare(dayKeyOf(a.date)));
  if (scope === "todas") return { visible: sorted, hidden: 0, fallback: false };
  const range = scope === "mes" ? zonedMonthRange(now) : zonedWeekRange(now);
  const from = zonedDayKey(range.from);
  const to = zonedDayKey(range.to);
  const inside = sorted.filter((row) => {
    const day = dayKeyOf(row.date);
    return Boolean(day) && day >= from && day < to;
  });
  if (scope === "mes") return { visible: inside, hidden: 0, fallback: false };
  if (inside.length === 0) {
    const visible = sorted.slice(0, HISTORY_CAP);
    return {
      visible,
      hidden: Math.max(0, sorted.length - visible.length),
      fallback: sorted.length > 0,
    };
  }
  const visible = inside.slice(0, HISTORY_CAP);
  return { visible, hidden: inside.length - visible.length, fallback: false };
}

/** «Por confirmar» shows 3 and a «Ver todas» so the recordings below stay in view. */
export const QUEUE_PREVIEW = 3;
