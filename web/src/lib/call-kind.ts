/** Calls that are not a live closer↔prospect sales meeting. */
export function isNonSalesCall(estado?: string | null) {
  const value = String(estado || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  return value === "INTERNA" || value === "NO_COMERCIAL";
}
