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

/** Match "Juan" to "Juan Pérez", or same company + first name. */
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

/** A pending call whose prospect is already a CRM lead, by id, call id, name or phone. */
export function callAlreadyInCrm(
  call: {
    id?: string;
    leadName?: string | null;
    title?: string | null;
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
  };
  const leadId = String(filing.lead_id || "").trim();
  if (leadId && leads.some((lead) => lead.id === leadId)) return true;
  if (call.id && leads.some((lead) => (lead.callIds || []).includes(call.id || ""))) return true;
  const named = leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    company: lead.company || "",
  }));
  const names = [filing.cliente_real, call.leadName, call.title]
    .map((value) => String(value || "").trim())
    .filter((value) => value && !/^(impromptu|google meet|zoom|llamada sin titulo|sin titulo)/i.test(value));
  if (names.some((name) => findMatchingLead(named, name))) return true;
  const phone = phoneDigits(String(filing.telefono || ""));
  if (phone && leads.some((lead) => phonesMatch(phone, phoneDigits(lead.telefono)))) return true;
  const email = String(filing.email || "").trim().toLowerCase();
  if (email && leads.some((lead) => String(lead.email || "").trim().toLowerCase() === email)) return true;
  return false;
}
