import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { extractLeadPlaybook } from "@/lib/lead-playbook";
import { getWorkspace } from "@/lib/workspace";
import { isUsableTranscript } from "@/lib/fathom-import";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_BYTES = 6 * 1024 * 1024;
const MAX_FILES = 20;

function fileTitle(name: string) {
  return name.replace(/\.[^.]+$/, "").slice(0, 120) || "Transcripción";
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;

    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((item): item is File => item instanceof File);
    const pasted = String(form.get("paste") || "").trim();

    if (files.length === 0 && pasted.length < 80) {
      return NextResponse.json(
        { error: "Sube archivos o pega al menos una transcripción" },
        { status: 400 },
      );
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Máximo ${MAX_FILES} archivos por tanda` },
        { status: 400 },
      );
    }

    let saved = 0;
    for (const file of files) {
      if (file.size > MAX_BYTES) continue;
      const text = await readTranscriptFile(file);
      if (!isUsableTranscript(text)) continue;
      await auth.prisma.clientTranscript.create({
        data: {
          userId: auth.userId,
          source: "upload",
          title: fileTitle(file.name),
          transcriptText: text.slice(0, 200_000),
        },
      });
      saved += 1;
    }

    if (pasted.length >= 80) {
      await auth.prisma.clientTranscript.create({
        data: {
          userId: auth.userId,
          source: "paste",
          title: `Pegado ${new Date().toLocaleDateString("es")}`,
          transcriptText: pasted.slice(0, 200_000),
        },
      });
      saved += 1;
    }

    if (saved === 0) {
      return NextResponse.json(
        { error: "No pude leer transcripciones útiles en esos archivos" },
        { status: 400 },
      );
    }

    const workspace = await getWorkspace(auth.prisma, auth.userId);
    if (workspace.offer) {
      try {
        const playbook = await extractLeadPlaybook({
          productName: workspace.offer.productName,
          productDescription: workspace.offer.productDescription,
          transcripts: workspace.corpus,
        });
        await auth.prisma.userOffer.update({
          where: { id: workspace.offer.id },
          data: { playbook: playbook as unknown as Prisma.InputJsonValue },
        });
      } catch (error) {
        console.error("playbook after transcripts", error);
      }
    }

    const next = await getWorkspace(auth.prisma, auth.userId);
    return NextResponse.json({
      saved,
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
