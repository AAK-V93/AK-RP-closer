import { isInternalMeetingTitle } from "@/lib/call-intake";
import { isNonSalesCall } from "@/lib/call-kind";
import { isExtractorJson, parseExtractorJson } from "@/lib/extractor";
import { callAlreadyInCrm, type CrmLeadRef } from "@/lib/lead-match";

/** A pending call the Llamadas card would still ask the closer to classify. */
export type ClassifiableCall = {
  id: string;
  leadName?: string | null;
  title?: string | null;
  summary?: string | null;
  estadoAgenda?: string | null;
  filingJson?: unknown;
};

/**
 * Same rule as the «llamadas por clasificar» card: drop internal calls and
 * anyone who is already a CRM lead. Inicio must count this list, not every
 * pending row.
 */
export function classifiablePending<T extends ClassifiableCall>(rows: T[], leads: CrmLeadRef[]) {
  return rows.filter((row) => {
    if (isNonSalesCall(row.estadoAgenda) || isInternalMeetingTitle(row.title)) return false;
    if (callAlreadyInCrm({ ...row, summary: row.summary }, leads)) return false;
    if (isExtractorJson(row.filingJson)) {
      const parsed = parseExtractorJson(row.filingJson);
      if (isNonSalesCall(parsed.estado_agenda)) return false;
      if (
        callAlreadyInCrm(
          {
            id: row.id,
            leadName: parsed.cliente_real || row.leadName,
            title: row.title,
            summary: row.summary || parsed.notas_crm,
            filingJson: { ...parsed, lead_id: (parsed as { lead_id?: string }).lead_id },
          },
          leads,
        )
      ) {
        return false;
      }
    }
    return true;
  });
}
