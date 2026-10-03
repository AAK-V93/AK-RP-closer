export type NamedLead = {
  id: string;
  name: string;
  company: string;
};

export function normalizePersonName(value: string) {
  return String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same person, accents aside. A longer CRM name still matches the shorter record. */
export function samePersonName(stored: string, shown: string) {
  const left = stored.trim();
  const right = shown.trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const a = normalizePersonName(left);
  const b = normalizePersonName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.split(" ").length < 2) return false;
  return longer.startsWith(`${shorter} `);
}

function tokens(value: string) {
  return normalizePersonName(value)
    .split(" ")
    .filter((part) => part.length > 1);
}

function containsName(a: string, b: string) {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

const NAME_PARTICLES = new Set([
  "de",
  "del",
  "la",
  "las",
  "los",
  "y",
  "e",
  "da",
  "do",
  "das",
  "dos",
  "van",
  "von",
]);

function significantTokens(value: string) {
  return normalizePersonName(value)
    .split(" ")
    .filter((part) => part.length > 1 && !NAME_PARTICLES.has(part));
}

function foldedName(value: string) {
  return significantTokens(value).join(" ");
}

/**
 * Full name only: same spelling once accents and case are folded, an exact
 * alias, a 2+ token prefix, or the same first and last token.
 * A shared first name is not a match.
 */
export function filingNamesFullyMatch(
  stored: string,
  shown: string,
  aliases?: readonly string[] | null,
) {
  const left = foldedName(stored);
  const right = foldedName(shown);
  if (!left || !right) return false;
  if (left === right) return true;
  for (const alias of aliases || []) {
    const folded = foldedName(alias);
    if (folded && folded === right) return true;
  }
  const leftTokens = left.split(" ");
  const rightTokens = right.split(" ");
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;
  if (samePersonName(left, right)) return true;
  return (
    leftTokens[0] === rightTokens[0] &&
    leftTokens[leftTokens.length - 1] === rightTokens[rightTokens.length - 1]
  );
}

export type FilingMatch<T> = { kind: "one"; lead: T } | { kind: "none" } | { kind: "ambiguous" };

/**
 * One full-name lead, no lead (the caller may create one), or ambiguous.
 * One token that is not an exact name stays ambiguous: do not merge and do not create.
 */
export function matchLeadForFiling<T extends { name: string; aliases?: readonly string[] | null }>(
  leads: readonly T[],
  name: string,
): FilingMatch<T> {
  const needle = foldedName(name);
  if (!needle) return { kind: "ambiguous" };
  const hits = leads.filter((lead) => filingNamesFullyMatch(lead.name, name, lead.aliases));
  if (hits.length === 1) return { kind: "one", lead: hits[0] };
  if (hits.length > 1) return { kind: "ambiguous" };
  if (needle.split(" ").length < 2) return { kind: "ambiguous" };
  // A lead stored as only «Edson» plus a call for «Edson Pérez» is not a new person.
  const first = needle.split(" ")[0];
  const bare = leads.filter((lead) => foldedName(lead.name) === first);
  if (bare.length === 1) return { kind: "ambiguous" };
  return { kind: "none" };
}

/** A bare first name that belongs to exactly one lead. Shared first names do not count. */
function uniqueFirstNameLead<T extends { name: string }>(leads: readonly T[], name: string) {
  const parts = significantTokens(name);
  if (parts.length !== 1) return null;
  const first = parts[0];
  if (first.length < 3) return null;
  const hits = leads.filter((lead) => significantTokens(lead.name)[0] === first);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Chat may resolve a unique first name. Filing stays on `matchLeadForFiling`.
 * Two leads with the same first name stay ambiguous and must not be written.
 */
export function matchLeadForChat<T extends { name: string; aliases?: readonly string[] | null }>(
  leads: readonly T[],
  name: string,
): FilingMatch<T> {
  const full = matchLeadForFiling(leads, name);
  if (full.kind === "one") return full;
  const parts = significantTokens(name);
  if (parts.length !== 1) return full;
  const first = parts[0];
  const hits = leads.filter((lead) => significantTokens(lead.name)[0] === first);
  if (hits.length === 1) return { kind: "one", lead: hits[0] };
  return { kind: "ambiguous" };
}

/** Match "Juan" to "Juan Pérez", or same company + first name. Not used to file a call. */
export function findMatchingLead<T extends NamedLead>(
  leads: T[],
  name: string,
  company?: string,
): T | null {
  const needle = normalizePersonName(name);
  if (!needle) return null;
  const companyNeedle = normalizePersonName(company || "");

  const exact = leads.find(
    (row) => normalizePersonName(row.name) === needle,
  );
  if (exact) return exact;

  const contained = leads.filter((row) =>
    containsName(normalizePersonName(row.name), needle),
  );
  if (contained.length === 1) return contained[0];
  if (companyNeedle) {
    const withCompany = contained.filter(
      (row) =>
        normalizePersonName(row.company) &&
        containsName(normalizePersonName(row.company), companyNeedle),
    );
    if (withCompany.length === 1) return withCompany[0];
  }

  const nameTokens = tokens(name);
  if (nameTokens.length) {
    const first = nameTokens[0];
    const firstMatches = leads.filter((row) => tokens(row.name)[0] === first);
    if (firstMatches.length === 1) return firstMatches[0];
    if (companyNeedle) {
      const firstAndCompany = firstMatches.filter((row) =>
        containsName(normalizePersonName(row.company), companyNeedle),
      );
      if (firstAndCompany.length === 1) return firstAndCompany[0];
    }
  }

  if (companyNeedle) {
    const byCompany = leads.filter((row) =>
      containsName(normalizePersonName(row.company), companyNeedle),
    );
    if (byCompany.length === 1) return byCompany[0];
  }

  return null;
}

export function phoneDigits(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function phonesMatch(left: string, right: string) {
  if (left.length < 8 || right.length < 8) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

export type CrmLeadRef = {
  id: string;
  name: string;
  company?: string;
  telefono?: string | null;
  email?: string | null;
  /** Call ids already stored on the lead (thread, alert, or filing). */
  callIds?: string[];
};

const MONTH_WORD =
  "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic";

/** "Valeria Ríos 29/9" and "Víctor/Jubher" still name the person. */
function nameCandidates(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const pieces = new Set<string>();
  const add = (text: string) => {
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (cleaned.length >= 3) pieces.add(cleaned);
  };
  const stripped = raw
    .replace(/\b\d{1,2}\s*[\/.\-]\s*\d{1,2}(?:\s*[\/.\-]\s*\d{2,4})?\b/g, " ")
    .replace(new RegExp(`\\b\\d{1,2}\\s+(?:de\\s+)?(?:${MONTH_WORD})(?:\\s+(?:de\\s+)?\\d{2,4})?\\b`, "ig"), " ")
    .replace(/\(\s*qa[^)]*\)/gi, " ");
  add(raw);
  add(stripped);
  for (const part of raw.split(/\s*[/|]\s*/)) add(part);
  return [...pieces];
}

function isBlankMeetingLabel(value: string) {
  return /^(impromptu|google meet|zoom|llamada sin titulo|sin titulo)/i.test(value.trim());
}

/** Threads, alerts and filing.lead_id point at the call record, not the lead name. */
export function crmLeadRefs(leads: CrmLeadRef[], links: Array<{ leadId?: string | null; callId?: string | null }>) {
  const extra = new Map<string, string[]>();
  for (const link of links) {
    const leadId = String(link.leadId || "").trim();
    const callId = String(link.callId || "").trim();
    if (!leadId || !callId) continue;
    const list = extra.get(leadId) || [];
    list.push(callId);
    extra.set(leadId, list);
  }
  return leads.map((lead) => ({
    ...lead,
    callIds: [...(lead.callIds || []), ...(extra.get(lead.id) || [])],
  }));
}

export function filingLeadId(filingJson: unknown) {
  if (!filingJson || typeof filingJson !== "object") return "";
  return String((filingJson as { lead_id?: unknown }).lead_id || "").trim();
}

/** A pending call whose prospect is already a CRM lead, by id, call id, name or phone. */
export function callAlreadyInCrm(
  call: {
    id?: string;
    leadName?: string | null;
    title?: string | null;
    summary?: string | null;
    /** Title the screen actually shows, when it differs from the raw meeting title. */
    label?: string | null;
    filingJson?: unknown;
  },
  leads: CrmLeadRef[],
) {
  if (!leads.length) return false;
  const filing = (call.filingJson || {}) as {
    lead_id?: unknown;
    cliente_real?: unknown;
    telefono?: unknown;
    email?: unknown;
    notas_crm?: unknown;
    summary?: unknown;
  };
  const leadId = String(filing.lead_id || "").trim();
  if (leadId && leads.some((lead) => lead.id === leadId)) return true;
  if (call.id && leads.some((lead) => (lead.callIds || []).includes(call.id || ""))) return true;
  const named = leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    company: lead.company || "",
  }));
  const identity = [filing.cliente_real, call.leadName, call.title, call.label]
    .flatMap((value) => nameCandidates(String(value || "")))
    .filter((value) => !isBlankMeetingLabel(value));
  const prose = [call.summary, filing.notas_crm, filing.summary]
    .map((value) => String(value || "").trim())
    .filter((value) => value && !isBlankMeetingLabel(value));
  const names = [...identity, ...prose];
  if (names.some((name) => matchLeadForFiling(named, name).kind === "one")) return true;
  if (names.some((name) => uniqueFirstNameLead(named, name))) return true;
  const blob = normalizePersonName(names.join(" "));
  if (
    blob &&
    leads.some((lead) => {
      const name = normalizePersonName(lead.name);
      return name.split(" ").length >= 2 && blob.includes(name);
    })
  ) {
    return true;
  }
  const phone = phoneDigits(String(filing.telefono || ""));
  if (phone && leads.some((lead) => phonesMatch(phone, phoneDigits(lead.telefono)))) return true;
  const email = String(filing.email || "").trim().toLowerCase();
  if (email && leads.some((lead) => String(lead.email || "").trim().toLowerCase() === email)) return true;
  return false;
}
