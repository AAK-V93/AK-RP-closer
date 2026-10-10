import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { ensureCrmTables, ensureFathomTables } from "@/lib/prisma";
import { EMPTY_TRANSCRIPT_MARK, isUsableTranscript } from "@/lib/fathom-import";
import { durationMinutesFromTranscript, placeLibraryCall, visibleCallTitle } from "@/lib/crm-noise";
import { fileCallQuietly } from "@/lib/file-call";
import { listPendingFilings, reviewPendingCall } from "@/lib/call-intelligence";
import { crmLeadRefs, filingLeadId, type CrmLeadRef } from "@/lib/lead-match";
import { Prisma } from "@prisma/client";

/** Start + end of a transcript (what durationMinutesFromTranscript reads), never the whole text. */
const TRANSCRIPT_SAMPLE_SQL = Prisma.sql`(left("transcriptText", 800) || E'\n' || right("transcriptText", 5000))`;

function queueItem(row: {
  id: string;
  title: string;
  leadName?: string;
  question: string;
  field: string;
  showToggle: boolean;
  options?: string[];
  date: string | null;
}) {
  return {
    id: row.id,
    title: row.title,
    leadName: row.leadName || "",
    question: row.question,
    field: row.field,
    showToggle: row.showToggle,
    options: row.options || [],
    date: row.date,
  };
}

export async function GET() {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);
    try {
      await ensureFathomTables(auth.prisma);
    } catch {
      /* optional */
    }

    const [fathom, uploads, tags, leadRows, threads, alerts] = await Promise.all([
      // Only a sample of each transcript (start + end, enough for the duration), not 80 full
      // transcripts per page load: less work for the database.
      auth.prisma.$queryRaw<
        { id: string; title: string; recordedAt: Date | null; syncedAt: Date; practiceSessionId: string | null; transcriptText: string }[]
      >`
        SELECT "id", "title", "recordedAt", "syncedAt", "practiceSessionId",
          CASE WHEN "transcriptText" = ${EMPTY_TRANSCRIPT_MARK} THEN ${EMPTY_TRANSCRIPT_MARK}
               ELSE ${TRANSCRIPT_SAMPLE_SQL} END AS "transcriptText"
        FROM "FathomRecording"
        WHERE "userId" = ${auth.userId}
        ORDER BY "recordedAt" DESC NULLS LAST, "syncedAt" DESC
        LIMIT 80
      `,
      auth.prisma.$queryRaw<{ id: string; title: string; createdAt: Date; transcriptText: string }[]>`
        SELECT "id", "title", "createdAt", ${TRANSCRIPT_SAMPLE_SQL} AS "transcriptText"
        FROM "ClientTranscript"
        WHERE "userId" = ${auth.userId}
        ORDER BY "createdAt" DESC
        LIMIT 80
      `,
      auth.prisma.callRecord.findMany({
        where: { userId: auth.userId },
      }),
      auth.prisma.lead.findMany({
        where: { userId: auth.userId },
        select: { id: true, name: true, company: true, telefono: true, email: true },
      }),
      auth.prisma.followupThread.findMany({
        where: { userId: auth.userId },
        select: { leadId: true, creadoDesdeCallRecordId: true },
      }),
      auth.prisma.leadAlert.findMany({
        where: { userId: auth.userId },
        select: { leadId: true, callRecordId: true },
      }),
    ]);
    const crmLeads: CrmLeadRef[] = crmLeadRefs(
      leadRows.map((lead) => ({
        id: lead.id,
        name: lead.name,
        company: lead.company,
        telefono: lead.telefono,
        email: lead.email,
      })),
      [
        ...threads.map((row) => ({ leadId: row.leadId, callId: row.creadoDesdeCallRecordId })),
        ...alerts.map((row) => ({ leadId: row.leadId, callId: row.callRecordId })),
        ...tags.map((row) => ({ leadId: filingLeadId(row.filingJson), callId: row.id })),
      ],
    );

    const tagKey = (source: string, id: string) => `${source}:${id}`;
    const tagMap = new Map(
      tags.map((row) => [tagKey(row.source, row.sourceId), row]),
    );

    const calls = [
      ...fathom
        .filter((row) => row.transcriptText !== EMPTY_TRANSCRIPT_MARK)
        .map((row) => {
          const tag = tagMap.get(tagKey("fathom", row.id));
          const leadName = tag?.leadName || "";
          const rawTitle = tag?.title || row.title;
          const rawWhen = row.recordedAt || tag?.recordedAt || row.syncedAt || null;
          const when = rawWhen ? new Date(rawWhen) : null;
          const date = when ? when.toISOString() : null;
          const title = visibleCallTitle({
            title: rawTitle,
            leadName,
            date: when,
            durationMinutes: durationMinutesFromTranscript(row.transcriptText),
            summary: tag?.summary,
          });
          const placed = placeLibraryCall({
            id: tag?.id,
            leadName,
            title: rawTitle,
            summary: tag?.summary,
            label: title,
            filingJson: tag?.filingJson,
            callType: tag?.callType,
            leads: crmLeads,
          });
          return {
            id: row.id,
            callRecordId: tag?.id || "",
            source: "fathom" as const,
            title,
            inCrm: placed.inCrm,
            interna: placed.interna,
            date,
            callType: tag?.callType || "",
            result: tag?.result || "",
            leadName,
            offerName: tag?.offerName || "",
            trainsBot: tag?.trainsBot || false,
            analyzed: Boolean(
              (row.practiceSessionId && row.practiceSessionId !== "skipped") ||
                tag?.practiceSessionId,
            ),
            href:
              row.practiceSessionId && row.practiceSessionId !== "skipped"
                ? `/coach/${row.practiceSessionId}`
                : tag?.practiceSessionId
                  ? `/coach/${tag.practiceSessionId}`
                  : "/llamadas",
          };
        }),
      ...uploads.map((row) => {
        const tag = tagMap.get(tagKey("upload", row.id));
        const leadName = tag?.leadName || "";
        const rawTitle = tag?.title || row.title;
        const when = new Date(tag?.recordedAt || row.createdAt);
        const date = new Date(when).toISOString();
        const title = visibleCallTitle({
          title: rawTitle,
          leadName,
          date: when,
          durationMinutes: durationMinutesFromTranscript(row.transcriptText),
          summary: tag?.summary,
        });
        const placed = placeLibraryCall({
          id: tag?.id,
          leadName,
          title: rawTitle,
          summary: tag?.summary,
          label: title,
          filingJson: tag?.filingJson,
          callType: tag?.callType,
          leads: crmLeads,
        });
        return {
          id: row.id,
          callRecordId: tag?.id || "",
          source: "upload" as const,
          title,
          inCrm: placed.inCrm,
          interna: placed.interna,
          date,
          callType: tag?.callType || "",
          result: tag?.result || "",
          leadName,
          offerName: tag?.offerName || "",
          trainsBot: tag?.trainsBot || false,
            analyzed: Boolean(tag?.practiceSessionId),
            href: tag?.practiceSessionId
              ? `/coach/${tag.practiceSessionId}`
              : "/llamadas",
        };
      }),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const pending = await listPendingFilings(auth.prisma, auth.userId);
    const queue = pending.map(queueItem);
    const review = queue[0] || null;

    return NextResponse.json({ calls, review, queue, unclassified: queue.length });
  } catch (error) {
    console.error("llamadas GET", error);
    return NextResponse.json({ error: "No se pudieron cargar las llamadas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    await ensureCrmTables(auth.prisma);

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        action?: "commercial" | "non_commercial" | "answer";
        callRecordId?: string;
        field?: string;
        value?: string;
      };
      if (body.action && body.callRecordId) {
        const result = await reviewPendingCall(auth.prisma, auth.userId, {
          callRecordId: body.callRecordId,
          action: body.action,
          field: body.field,
          value: body.value,
        });
        const pending = await listPendingFilings(auth.prisma, auth.userId);
        const queue = pending.map(queueItem);
        return NextResponse.json({
          ok: true,
          result,
          review: queue[0] || null,
          queue,
          unclassified: queue.length,
        });
      }
    }
    try {
      await ensureFathomTables(auth.prisma);
    } catch {
      /* optional */
    }

    const tagged = await auth.prisma.callRecord.findMany({
      where: { userId: auth.userId },
      select: { source: true, sourceId: true },
    });
    const seen = new Set(tagged.map((row) => `${row.source}:${row.sourceId}`));

    const [fathom, uploads] = await Promise.all([
      // Length only; the one transcript to file is loaded below.
      auth.prisma.$queryRaw<{ id: string; title: string; recordedAt: Date | null; usable: boolean }[]>`
        SELECT "id", "title", "recordedAt",
          (length(btrim("transcriptText")) >= 80 AND "transcriptText" <> ${EMPTY_TRANSCRIPT_MARK}) AS "usable"
        FROM "FathomRecording" WHERE "userId" = ${auth.userId}
        ORDER BY "recordedAt" DESC NULLS LAST LIMIT 30
      `,
      auth.prisma.$queryRaw<{ id: string; title: string; createdAt: Date; usable: boolean }[]>`
        SELECT "id", "title", "createdAt",
          (length(btrim("transcriptText")) >= 80 AND "transcriptText" <> ${EMPTY_TRANSCRIPT_MARK}) AS "usable"
        FROM "ClientTranscript" WHERE "userId" = ${auth.userId}
        ORDER BY "createdAt" DESC LIMIT 30
      `,
    ]);

    const pendingFathom = fathom.find((row) => !seen.has(`fathom:${row.id}`) && row.usable);
    const pendingUpload = pendingFathom ? undefined : uploads.find((row) => !seen.has(`upload:${row.id}`) && row.usable);
    const fathomText = pendingFathom
      ? (await auth.prisma.fathomRecording.findFirst({ where: { id: pendingFathom.id, userId: auth.userId }, select: { transcriptText: true } }))?.transcriptText || ""
      : "";
    const uploadText = pendingUpload
      ? (await auth.prisma.clientTranscript.findFirst({ where: { id: pendingUpload.id, userId: auth.userId }, select: { transcriptText: true } }))?.transcriptText || ""
      : "";
    const next = pendingFathom && isUsableTranscript(fathomText)
      ? {
          source: "fathom" as const,
          sourceId: pendingFathom.id,
          title: pendingFathom.title,
          transcript: fathomText,
          recordedAt: pendingFathom.recordedAt ? new Date(pendingFathom.recordedAt) : null,
        }
      : pendingUpload && isUsableTranscript(uploadText)
        ? {
            source: "upload" as const,
            sourceId: pendingUpload.id,
            title: pendingUpload.title,
            transcript: uploadText,
            recordedAt: new Date(pendingUpload.createdAt),
          }
        : null;

    if (!next) return NextResponse.json({ classified: 0, done: true });

    const taggedCall = await fileCallQuietly(auth.prisma, auth.userId, next);
    return NextResponse.json({
      classified: taggedCall ? 1 : 0,
      done: !taggedCall,
      call: taggedCall,
    });
  } catch (error) {
    console.error("llamadas POST", error);
    return NextResponse.json({ error: "No se pudo clasificar" }, { status: 500 });
  }
}
