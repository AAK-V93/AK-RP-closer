export const OFFER_SAVE_TIMEOUT_MS = 25_000;

export const OFFER_SAVE_TIMEOUT_MESSAGE =
  "No pude confirmar el guardado. Revisa Ofertas: si la oferta está ahí, ya quedó guardada.";

export function offerSavedLabel(count: number) {
  return count > 1 ? `Guardé ${count} ofertas` : "Guardé la oferta";
}

/** The route returns 400 below these lengths. Do not send that request. */
export function isCompleteOfferSave(body: {
  productName?: string | null;
  productDescription?: string | null;
}) {
  return (
    (body.productName?.trim().length || 0) >= 2 &&
    (body.productDescription?.trim().length || 0) >= 20
  );
}

export function filterPersistableOffers<
  T extends { productName?: string | null; productDescription?: string | null },
>(offers: T[]) {
  return offers.filter((offer) => isCompleteOfferSave(offer));
}

export function offerSaveFailureMessage(error: unknown, aborted = false) {
  if (aborted) return OFFER_SAVE_TIMEOUT_MESSAGE;
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return OFFER_SAVE_TIMEOUT_MESSAGE;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "No se guardó la oferta";
}

export async function postWorkspaceOffer(
  body: unknown,
): Promise<{ id: string | null }> {
  const record = (body || {}) as {
    productName?: string | null;
    productDescription?: string | null;
  };
  if (!isCompleteOfferSave(record)) {
    throw new Error("Nombre y descripción de la oferta son obligatorios");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OFFER_SAVE_TIMEOUT_MS);
  try {
    const response = await fetch("/api/workspace/offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      offer?: { id?: string };
    };
    if (!response.ok) {
      throw new Error(data.error || "No se guardó la oferta");
    }
    return { id: data.offer?.id || null };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(OFFER_SAVE_TIMEOUT_MESSAGE);
    }
    throw error instanceof Error ? error : new Error("No se guardó la oferta");
  } finally {
    clearTimeout(timer);
  }
}
