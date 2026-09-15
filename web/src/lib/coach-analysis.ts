export const CONFIRM_DELETE_ANALYSIS =
  "¿Borrar este análisis? Se quita de tu historial del coach. No se puede deshacer.";

export async function deleteCoachAnalysis(id: string) {
  const response = await fetch(`/api/coach/${id}`, { method: "DELETE" });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "No se pudo borrar el análisis");
  }
}
