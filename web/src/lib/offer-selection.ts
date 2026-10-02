/** The clicked offer, not whichever row was updated most recently. */
export function pickWorkspaceOffer<T extends { id: string }>(
  offers: T[],
  offerId?: string | null,
): T | null {
  if (offerId === "") return null;
  const id = String(offerId || "").trim();
  if (id) return offers.find((row) => row.id === id) || null;
  return offers[0] || null;
}
