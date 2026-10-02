import { pasoLabel, sequenceFor, type ThreadTipo } from "@/lib/followup-machine";
import { plainStatus } from "@/lib/plain-labels";

function sequenceTipo(raw: string): ThreadTipo | "GENERIC" | null {
  const key = raw
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
  if (!key || key === "—" || key === "-") return null;
  if (key === "ONBOARDING") return "ONBOARDING";
  if (key === "DECISION") return "DECISION";
  if (key === "RETOMAR") return "RETOMAR";
  if (key === "REAGENDAR") return "REAGENDAR";
  if (key.includes("SEGUNDA") || key.includes("REUNION")) return "SEGUNDA_REUNION";
  if (key === "COBRANZA" || key.includes("PAGO") || key.includes("COBRO")) return "COBRANZA";
  if (key === "CIERRE VENTA" || key === "PERDIDO" || key === "CERRADO" || key === "ACUERDO SIN PAGO") {
    return null;
  }
  if (key === "SEGUIMIENTO" || key === "PENDIENTE") return "GENERIC";
  return "GENERIC";
}

/** Paso stored on the thread, or the first step of that follow-up sequence. */
export function derivedPaso(args: {
  paso?: string | null;
  tipo?: string | null;
  intentos?: number | null;
}) {
  const raw = String(args.paso || "").trim();
  if (raw && raw !== "—") return /^paso\b/i.test(raw) ? raw : `Paso ${raw}`;
  const tipo = sequenceTipo(String(args.tipo || ""));
  if (!tipo) return "";
  if (tipo === "GENERIC") return "Paso 1 de 1";
  const total = sequenceFor(tipo).steps.length;
  const index = Math.min(Math.max(Number(args.intentos || 0), 0), Math.max(total - 1, 0));
  return `Paso ${pasoLabel(index, total)}`;
}

export function operacionGlance(args: {
  fecha?: string | null;
  fechaProximo?: string | null;
  tipoSeguimiento?: string | null;
  paso?: string | null;
  intentos?: number | null;
  ultimoContacto?: string | null;
}) {
  const paso = derivedPaso({
    paso: args.paso,
    tipo: args.tipoSeguimiento,
    intentos: args.intentos,
  });
  const ultimoContacto = String(args.ultimoContacto || args.fecha || "").trim().slice(0, 16) || "—";
  const tipo = plainStatus(args.tipoSeguimiento);
  const when = String(args.fechaProximo || "").trim();
  const parts = [tipo !== "—" ? tipo : "", when].filter(Boolean);
  const siguiente = parts.length ? parts.join(" · ") : "Sin próximo paso";
  const line = [
    paso,
    ultimoContacto !== "—" ? `Último contacto ${ultimoContacto}` : "",
    `Siguiente: ${siguiente}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { paso, ultimoContacto, siguiente, line };
}
