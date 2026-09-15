export type NamedLead = {
  id: string;
  name: string;
  company: string;
};

export function normalizePersonName(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
