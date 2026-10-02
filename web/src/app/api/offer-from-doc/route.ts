import { NextResponse } from "next/server";
import dotenv from "dotenv";
import path from "path";
import { commercialRecap } from "@/lib/offer-commercial";
import {
  extractOfferBatchFromInput,
  fileFromBlob,
  offerBatchRecap,
  textFromOfferFiles,
} from "@/lib/offer-extract";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

export const runtime = "nodejs";
/** Local PDF read, or one 40s model call. This route stays at the 60s cap. */
export const maxDuration = 60;

async function filesFromForm(form: FormData) {
  const rows: File[] = [];
  const many = form.getAll("files");
  for (const item of many) {
    if (item instanceof File && item.size > 0) rows.push(item);
  }
  const one = form.get("file");
  if (one instanceof File && one.size > 0) rows.push(one);
  return rows;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const paste = String(form.get("paste") || form.get("text") || "").trim();
    const step = String(form.get("step") || "");
    const uploads = await filesFromForm(form);
    if (!paste && !uploads.length) {
      return NextResponse.json(
        { error: "Pega un texto o sube un PDF/TXT" },
        { status: 400 },
      );
    }

    const files = await Promise.all(
      uploads.map(async (file) => fileFromBlob(file, Buffer.from(await file.arrayBuffer()))),
    );
    const read = files.length ? await textFromOfferFiles(files) : { text: "", binaries: [] };

    if (step === "read") {
      return NextResponse.json({
        text: [paste, read.text].filter(Boolean).join("\n\n"),
        needsModelFile: read.binaries.length > 0 && read.text.trim().length < 40 && !paste,
      });
    }

    const batch = await extractOfferBatchFromInput({
      text: [paste, read.text].filter(Boolean).join("\n\n"),
      files: read.binaries,
    });
    const first = batch.offers[0];

    return NextResponse.json({
      assumption: batch.assumption,
      questions: batch.questions,
      offers: batch.offers,
      recap: offerBatchRecap(batch),
      productName: first?.productName || "",
      productDescription: first?.productDescription || "",
      pitchSummary: first?.pitchSummary || "",
      icp: first?.icp || "",
      commercial: first?.commercial || null,
      commercialRecap: first ? commercialRecap(first.commercial) : "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = /timeout|tardó|abort|deadline/i.test(message);
    return NextResponse.json(
      {
        error: timedOut
          ? "La extracción tardó demasiado y se cortó. Pulsa Reintentar."
          : "No pude leer ese documento. Pulsa Reintentar.",
        details: message,
      },
      { status: timedOut ? 504 : 500 },
    );
  }
}
