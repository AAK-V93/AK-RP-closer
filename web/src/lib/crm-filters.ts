export type CrmListFilter = {
  q: string;
  estado: string;
  month: string;
  week: string;
};

export const EMPTY_CRM_FILTER: CrmListFilter = {
  q: "",
  estado: "",
  month: "",
  week: "",
};

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function calendarDay(value: string | null | undefined) {
  const day = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

export function monthKey(value: string | null | undefined) {
  const day = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(0, 7) : "";
}

export function monthLabel(key: string) {
  const [year, month] = key.split("-");
  const index = Number(month) - 1;
  if (!year || index < 0 || index > 11) return key;
  return `${MONTHS[index]} ${year}`;
}

/** Monday of the week that contains the date, as YYYY-MM-DD. */
export function weekKey(value: string | null | undefined) {
  const date = calendarDay(value);
  if (!date) return "";
  const weekday = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  const month = String(monday.getMonth() + 1).padStart(2, "0");
  const day = String(monday.getDate()).padStart(2, "0");
  return `${monday.getFullYear()}-${month}-${day}`;
}

export function weekLabel(mondayKey: string) {
  const start = calendarDay(mondayKey);
  if (!start) return mondayKey;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const left = `${start.getDate()} ${MONTHS[start.getMonth()]}`;
  const right = `${end.getDate()} ${MONTHS[end.getMonth()]}`;
  return `${left} – ${right}`;
}

export function matchesCrmListFilter(
  row: { name: string; date: string | null | undefined; estado: string },
  filter: CrmListFilter,
) {
  const q = filter.q.trim().toLowerCase();
  if (q && !row.name.toLowerCase().includes(q)) return false;
  if (filter.estado && row.estado.toUpperCase() !== filter.estado.toUpperCase()) return false;
  if (filter.month && monthKey(row.date) !== filter.month) return false;
  if (filter.week && weekKey(row.date) !== filter.week) return false;
  return true;
}

export function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
}
