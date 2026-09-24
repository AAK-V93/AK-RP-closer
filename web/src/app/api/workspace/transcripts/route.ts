import { NextResponse } from "next/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { extractLeadPlaybook } from "@/lib/lead-playbook";
import { getWorkspace } from "@/lib/workspace";
import { isUsableTranscript } from "@/lib/fathom-import";
import { fileCallQuietly } from "@/lib/file-call";
import { MAX_TRANSCRIPT_BYTES, transcriptTitle } from "@/lib/transcript-batch";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_BYTES = MAX_TRANSCRIPT_BYTES;

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return handleTranscriptJson(request, auth.prisma, auth.userId);
    }

    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((item): item is File => item instanceof File);
    const pasted = String(form.get("paste") || "").trim();
    const offerId = String(form.get("offerId") || "").trim() || null;

    if (files.length === 0 && pasted.length < 80) {
      return NextResponse.json(
        { error: "Sube archivos o pega al menos una transcripción" },
        { status: 400 },
      );
    }
    const batch = form.get("batch") === "1";
    const titles = files.map((file) => transcriptTitle(file.name));
    const existing = titles.length
      ? await auth.prisma.clientTranscript.findMany({
          where: { userId: auth.userId, offerId, title: { in: titles } },
          select: { id: true, title: true },
        })
      : [];
    const alreadyFiled = new Set(
      existing.length
        ? (
            await auth.prisma.callRecord.findMany({
              where: {
                userId: auth.userId,
                source: "upload",
                sourceId: { in: existing.map((row) => row.id) },
              },
              select: { sourceId: true },
            })
          ).map((row) => row.sourceId)
        : [],
    );
    const byTitle = new Map(existing.map((row) => [row.title, row.id]));

    let saved = 0;
    let already = 0;
    let unreadable = 0;
    let tooBig = 0;
    const toFile: string[] = [];
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        tooBig += 1;
        continue;
      }
      const title = transcriptTitle(file.name);
      const prior = byTitle.get(title);
      if (prior) {
        already += 1;
        if (!alreadyFiled.has(prior)) toFile.push(prior);
        continue;
      }
      const text = await readTranscriptFile(file);
      if (!isUsableTranscript(text)) {
        unreadable += 1;
        continue;
      }
      const created = await auth.prisma.clientTranscript.create({
        data: {
          userId: auth.userId,
          offerId,
          source: "upload",
          title,
          transcriptText: text.slice(0, 200_000),
        },
      });
      byTitle.set(title, created.id);
      saved += 1;
      if (batch) {
        toFile.push(created.id);
      } else {
        await fileCallQuietly(auth.prisma, auth.userId, {
          source: "upload",
          sourceId: created.id,
          title: created.title,
          transcript: created.transcriptText,
          recordedAt: created.createdAt,
        });
      }
    }

    if (pasted.length >= 80) {
      const pastedRow = await auth.prisma.clientTranscript.create({
        data: {
          userId: auth.userId,
          offerId,
          source: "paste",
          title: `Pegado ${new Date().toLocaleDateString("es")}`,
          transcriptText: pasted.slice(0, 200_000),
        },
      });
      await fileCallQuietly(auth.prisma, auth.userId, {
        source: "upload",
        sourceId: pastedRow.id,
        title: pastedRow.title,
        transcript: pastedRow.transcriptText,
        recordedAt: pastedRow.createdAt,
      });
      saved += 1;
    }

    if (saved === 0 && toFile.length === 0 && already === 0) {
      return NextResponse.json(
        { error: "No pude leer transcripciones útiles en esos archivos" },
        { status: 400 },
      );
    }

    if (!batch) await refreshPlaybook(auth.prisma, auth.userId, offerId);

    const next = await getWorkspace(auth.prisma, auth.userId, offerId);
    return NextResponse.json({
      saved,
      already,
      unreadable,
      tooBig,
      toFile: [...new Set(toFile)],
      ready: next.ready,
      transcriptCount: next.transcriptCount,
      playbookReady: next.playbookReady,
      transcripts: next.transcripts,
    });
  } catch (error) {
    console.error("workspace transcripts", error);
    return NextResponse.json(
      { error: "No se pudieron guardar las transcripciones" },
      { status: 500 },
    );
  }
}

async function handleTranscriptJson(request: Request, prisma: PrismaClient, userId: string) {
  const body = (await request.json()) as { offerId?: string; fileId?: string; finalize?: boolean };
  const offerId = String(body.offerId || "").trim() || null;
  if (body.finalize) {
    await refreshPlaybook(prisma, userId, offerId);
    const next = await getWorkspace(prisma, userId, offerId);
    return NextResponse.json({
      ready: next.ready,
      transcriptCount: next.transcriptCount,
      playbookReady: next.playbookReady,
      transcripts: next.transcripts,
    });
  }
  const fileId = String(body.fileId || "").trim();
  if (!fileId) {
    return NextResponse.json({ error: "Falta la transcripción" }, { status: 400 });
  }
  const row = await prisma.clientTranscript.findFirst({
    where: { id: fileId, userId },
  });
  if (!row) return NextResponse.json({ error: "No está esa transcripción" }, { status: 404 });
  const prior = await prisma.callRecord.findFirst({
    where: { userId, source: "upload", sourceId: row.id },
    select: { id: true },
  });
  if (prior) return NextResponse.json({ filed: false, already: true });
  const filed = await fileCallQuietly(prisma, userId, {
    source: "upload",
    sourceId: row.id,
    title: row.title,
    transcript: row.transcriptText,
    recordedAt: row.createdAt,
  });
  return NextResponse.json({ filed: Boolean(filed), already: false });
}

async function refreshPlaybook(prisma: PrismaClient, userId: string, offerId: string | null) {
  const workspace = await getWorkspace(prisma, userId, offerId);
  if (!workspace.offer) return;
  try {
    const playbook = await extractLeadPlaybook({
      productName: workspace.offer.productName,
      productDescription: workspace.offer.productDescription,
      transcripts: workspace.corpus,
      existing: workspace.playbook,
    });
    await prisma.userOffer.update({
      where: { id: workspace.offer.id },
      data: { playbook: playbook as unknown as Prisma.InputJsonValue },
    });
  } catch (error) {
    console.error("playbook after transcripts", error);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json()) as { id?: string };
    if (!body.id) {
      return NextResponse.json({ error: "Falta el id" }, { status: 400 });
    }
    await auth.prisma.clientTranscript.deleteMany({
      where: { id: body.id, userId: auth.userId },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("workspace transcript delete", error);
    return NextResponse.json(
      { error: "No se pudo borrar" },
      { status: 500 },
    );
  }
}

async function readTranscriptFile(file: File) {
  const name = file.name.toLowerCase();
  const mime = file.type || "";
  const buffer = Buffer.from(await file.arrayBuffer());
  if (
    mime.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".vtt") ||
    name.endsWith(".srt") ||
    name.endsWith(".csv")
  ) {
    return buffer.toString("utf8");
  }
  if (name.endsWith(".pdf") || mime === "application/pdf") {
    const { generateGeminiParts } = await import("@/lib/gemini");
    const text = await generateGeminiParts(
      [
        {
          text: "Extrae el texto completo de esta transcripción o documento de llamada. Solo el diálogo, sin comentario.",
        },
        {
          inlineData: {
            mimeType: "application/pdf",
            data: buffer.toString("base64"),
          },
        },
      ],
      0.1,
      8192,
      { timeoutMs: 60_000, models: ["gemini-flash-lite-latest"] },
    );
    return text;
  }
  return buffer.toString("utf8");
}
