import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { ensureCrmTables } from "@/lib/prisma";
import { classifyAndFileCall } from "@/lib/call-intelligence";
import { isUsableTranscript } from "@/lib/fathom-import";

// Filing reads the call with the model, like a new call (same path as Llamadas).
export const maxDuration = 120;

/**
 * «Agregar al CRM» from the ficha of an old call. Only runs when the closer taps «Guardar»:
 * the recording goes through the normal filing, the same as a new call in Llamadas.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json().catch(() => ({}))) as { recordingId?: string; kind?: string };
    const id = String(body.recordingId || "").trim();
    const kind = body.kind === "upload" ? "upload" : "fathom";
    if (!id) return NextResponse.json({ error: "Falta la llamada." }, { status: 400 });
    await ensureCrmTables(auth.prisma);
    const row =
      kind === "fathom"
        ? await auth.prisma.fathomRecording
            .findFirst({ where: { id, userId: auth.userId }, select: { id: true, title: true, recordedAt: true, transcriptText: true } })
            .then((found) => (found ? { ...found, at: found.recordedAt } : null))
        : await auth.prisma.clientTranscript
            .findFirst({ where: { id, userId: auth.userId }, select: { id: true, title: true, createdAt: true, transcriptText: true } })
            .then((found) => (found ? { ...found, at: found.createdAt } : null));
    if (!row) return NextResponse.json({ error: "No encontré esa llamada." }, { status: 404 });
    if (!isUsableTranscript(row.transcriptText)) {
      return NextResponse.json({ error: "Esa grabación no tiene transcripción, así que no la puedo agregar." }, { status: 400 });
    }
    const already = await auth.prisma.callRecord.findFirst({
      where: { userId: auth.userId, source: kind, sourceId: row.id },
      select: { id: true, filingStatus: true },
    });
    if (already) return NextResponse.json({ ok: true, already: true, filingStatus: already.filingStatus });
    const result = await classifyAndFileCall(auth.prisma, auth.userId, {
      source: kind,
      sourceId: row.id,
      title: row.title,
      transcript: row.transcriptText,
      recordedAt: row.at,
    });
    return NextResponse.json({ ok: true, filingStatus: result.filingStatus, question: result.gap?.question || "" });
  } catch (error) {
    console.error("crm ficha agregar", error);
    return NextResponse.json({ error: "No pude agregarla. Inténtalo otra vez." }, { status: 500 });
  }
}
