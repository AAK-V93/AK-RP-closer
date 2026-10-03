/** What the CRM tabs are counting, in the closer's words. */

import { CRM_TIMEZONE, zonedParts } from "@/lib/crm-time";

const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export const AHORA_TAB_NOTE =
  "Esto es lo de hoy: seguimientos, citas y dinero que sigue abierto. El rendimiento de abajo separa lo cobrado este mes del cobrado total.";

/** Names the months in America/Bogota. October compares octubre with septiembre. */
export function periodoTabNote(at: Date = new Date(), timeZone = CRM_TIMEZONE) {
  const { month } = zonedParts(at, timeZone);
  const current = MONTHS_ES[month - 1] || "este mes";
  const previous = MONTHS_ES[(month + 10) % 12] || "el mes anterior";
  return `Cada fila compara ${current}, ${previous} y el total. No es la lista de lo que toca hoy.`;
}

export const COBRADO_PERIOD_NOTE =
  "Cobrado este mes suma los pagos con fecha en el mes. Cobrado total suma todos los pagos. La fecha de la venta no cambia el cobrado.";

export const SEGUIMIENTOS_SALDO_NOTE =
  "Saldo por cobrar es lo que falta de los cierres: la venta menos lo ya cobrado. No es el cobrado.";

/** Same figures the period table uses. The names say which window each one is. */
export function cobradoPeriodLine(month: string, total: string) {
  return `Cobrado este mes ${month}. Cobrado total ${total}.`;
}

/** The Seguimientos line names the open balance. 531 is that balance, not lo cobrado. */
export function seguimientosHeader(status: string, saldo: string) {
  return `${status} · Saldo por cobrar ${saldo}`;
}
