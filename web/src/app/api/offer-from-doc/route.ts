import { NextResponse } from "next/server";
import dotenv from "dotenv";
import path from "path";
import { commercialRecap } from "@/lib/offer-commercial";
import {
  extractOfferBatchFromInput,
  fileFromBlob,
  offerBatchRecap,
} from "@/lib/offer-extract";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

export const runtime = "nodejs";
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
    const uploads = await filesFromForm(form);
    if (!paste && !uploads.length) {
      return NextResponse.json(
        { error: "Pega un texto o sube un PDF/TXT" },
        { status: 400 },
      );
    }

    const files = await Promise.all(
      uploads.map(async (file) =>
        fileFromBlob(file, Buffer.from(await file.arrayBuffer())),
      ),
    );

    const batch = await extractOfferBatchFromInput({ text: paste, files });
    const first = batch.offers[0];

    return NextResponse.json({
      assumption: batch.assumption,
      questions: batch.questions,
      offers: batch.offers,
      recap: offerBatchRecap(batch),
      productName: first?.productName || "",
      productDescription: first?.productDescription || "",
      pitchSummary: first?.pitchSummary || "",
      commercial: first?.commercial || null,
      commercialRecap: first ? commercialRecap(first.commercial) : "",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Error al procesar la oferta",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
