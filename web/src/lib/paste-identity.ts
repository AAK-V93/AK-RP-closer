import { createHash } from "node:crypto";
import { formatCrmDate, zonedDayKey } from "@/lib/crm-time";
import { inferCallDate, inferLeadLabel } from "@/lib/followup-date";
import { normalizePersonName } from "@/lib/lead-match";

export type PasteFingerprint = {
  hash: string;
  leadKey: string;
  leadLabel: string;
  day: string;
  phone: string;
  email: string;
};

export function transcriptHash(text: string) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function digits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

export function phoneFromText(text: string) {
  const hit = String(text || "").match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,5}\d{2,4}/);
  const found = digits(hit?.[0] || "");
  if (found.length < 8 || found.length > 15) return "";
  return found;
}

export function emailFromText(text: string) {
  const hit = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return hit ? hit[0].toLowerCase() : "";
}

export function fingerprintPaste(text: string, now = new Date()): PasteFingerprint {
  const leadLabel = inferLeadLabel(text);
  const callAt = inferCallDate(text, now);
  return {
    hash: transcriptHash(text),
    leadKey: normalizePersonName(leadLabel),
    leadLabel,
    day: callAt ? zonedDayKey(callAt) : "",
    phone: phoneFromText(text),
    email: emailFromText(text),
  };
}

export function fingerprintCall(call: {
  leadName?: string | null;
  recordedAt?: Date | string | null;
  createdAt?: Date | string | null;
  filingJson?: unknown;
}): PasteFingerprint {
  const filing = (call.filingJson || {}) as { telefono?: string; email?: string; cliente_real?: string };
  const leadLabel = String(call.leadName || filing.cliente_real || "").trim();
  const raw = call.recordedAt || call.createdAt;
  const at = raw instanceof Date ? raw : raw ? new Date(raw) : null;
  return {
    hash: "",
    leadKey: normalizePersonName(leadLabel),
    leadLabel: leadLabel.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim(),
    day: at && !Number.isNaN(at.getTime()) ? zonedDayKey(at) : "",
    phone: digits(String(filing.telefono || "")),
    email: String(filing.email || "").trim().toLowerCase(),
  };
}

export function duplicateReason(incoming: PasteFingerprint, existing: PasteFingerprint) {
  if (incoming.hash && existing.hash && incoming.hash === existing.hash) return "hash" as const;
  if (!incoming.day || incoming.day !== existing.day) return "";
  if (incoming.leadKey && existing.leadKey && incoming.leadKey === existing.leadKey) {
    return "lead-date" as const;
  }
  if (incoming.phone && existing.phone && incoming.phone === existing.phone) {
    return "contact-date" as const;
  }
  if (incoming.email && existing.email && incoming.email === existing.email) {
    return "contact-date" as const;
  }
  return "";
}

function spokenDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const [year, month, date] = day.split("-").map(Number);
  return formatCrmDate(new Date(Date.UTC(year, month - 1, date, 12)));
}

export function duplicatePasteMessage(
  reason: "hash" | "lead-date" | "contact-date",
  incoming: PasteFingerprint,
) {
  if (reason === "hash") return "Esta transcripción ya estaba. No creé otra fila.";
  const who = incoming.leadLabel || "ese lead";
  const day = spokenDay(incoming.day);
  if (day) return `Ya hay una llamada de ${who} el ${day}. No creé otra fila.`;
  return `Ya hay una llamada de ${who}. No creé otra fila.`;
}
