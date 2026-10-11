// Confirmar copy helpers (display only).
import { type DayKey, addDaysKey, bogotaDay } from "@/lib/time/bogota";

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** «hoy», «ayer» or «viernes 9 oct» (Bogotá day). */
export function callDay(iso: string, today: DayKey) {
  const day = bogotaDay(new Date(iso));
  if (day === today) return "hoy";
  if (day === addDaysKey(today, -1)) return "ayer";
  const d = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** «Círculo Millonario · ayer, 45 min»; without a known duration no «min». */
export function callMeta(offerName: string | null, iso: string, durationSec: number | null, today: DayKey) {
  const when = callDay(iso, today);
  const mins = durationSec && durationSec > 0 ? `, ${Math.max(1, Math.round(durationSec / 60))} min` : "";
  return [offerName, `${when}${mins}`].filter(Boolean).join(" · ");
}
