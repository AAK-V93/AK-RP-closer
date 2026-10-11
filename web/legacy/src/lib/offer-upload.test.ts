import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExtractorJson } from "./extractor";
import { ensureCommissionQuestion, offerBatchRecap, OFFER_MODEL_TIMEOUT_MS, textFromOfferFiles } from "./offer-extract";
import { emptyCommercial, looksLikeOfferBlob } from "./offer-commercial";
import { OFFER_CLIENT_TIMEOUT_MS, offerFailureMessage, runOfferExtraction } from "./offer-upload";

test("a Vercel HTML error page becomes a Spanish retry", () => {
  const html = "An error occurred with your deployment\nFUNCTION_INVOCATION_TIMEOUT";
  assert.match(offerFailureMessage(504, html), /Pulsa Reintentar/);
  assert.doesNotMatch(offerFailureMessage(504, html), /Unexpected token/);
  assert.equal(
    offerFailureMessage(500, JSON.stringify({ error: "No pude leer ese documento. Pulsa Reintentar." })),
    "No pude leer ese documento. Pulsa Reintentar.",
  );
});

test("generated notes say Asistió", () => {
  const parsed = parseExtractorJson({ notas_crm: "SHOW. No cerró." });
  assert.equal(parsed.notas_crm, "Asistió. No cerró.");
});

test("extraction always asks about commission", () => {
  const asked = ensureCommissionQuestion(["Se llama «Fertilidad». ¿Es así?"], false);
  assert.match(asked[0] || "", /comisi/i);
  assert.match(asked[0] || "", /¿La dejo vacía\?/);
  const kept = ensureCommissionQuestion(["La comisión queda en 10%. ¿Es así?"], true);
  assert.equal(kept.length, 1);
});

test("two steps show progress and do not parse HTML", async () => {
  const seen: string[] = [];
  const bodies: string[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const form = init?.body as FormData;
    bodies.push(String(form.get("step") || "extract"));
    if (form.get("step") === "read") {
      return new Response(JSON.stringify({ text: "Oferta Fertilidad. Precio USD 10000.", needsModelFile: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      assumption: "una",
      questions: ["No encontré un porcentaje de comisión. ¿La dejo vacía?"],
      offers: [{
        productName: "Fertilidad Consciente",
        productDescription: "Acompañamiento",
        pitchSummary: "",
        icp: "",
        commercial: {},
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const result = await runOfferExtraction(
    {
      paste: "Oferta Fertilidad Consciente con precio y comisión por escribir.",
      onProgress: (message) => seen.push(message),
    },
    fetchImpl,
  );
  assert.deepEqual(bodies, ["read", "extract"]);
  assert.deepEqual(seen, ["Leyendo el documento…", "Extrayendo precios y comisión…"]);
  assert.match(result.questions[0] || "", /comisi/i);
  assert.equal(result.offers[0]?.productName, "Fertilidad Consciente");
});

function simplePdf(pages: string[]) {
  const objects: string[] = [];
  const kids: string[] = [];
  let id = 3;
  const fontId = 3 + pages.length * 2;
  for (const page of pages) {
    const pageId = id;
    const streamId = id + 1;
    id += 2;
    kids.push(`${pageId} 0 R`);
    const stream = `BT /F1 12 Tf 72 700 Td (${page.replace(/[()\\]/g, "")}) Tj ET`;
    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${streamId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >> endobj\n`,
    );
    objects.push(`${streamId} 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream\nendobj\n`);
  }
  objects.push(`${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n`);
  const all = [
    `1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n`,
    `2 0 obj << /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >> endobj\n`,
    ...objects,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of all) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xrefAt = Buffer.byteLength(body);
  let xref = `xref\n0 ${all.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= all.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `${xref}trailer << /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body);
}

test("the model budget stays inside the function limit", () => {
  assert.equal(OFFER_MODEL_TIMEOUT_MS, 10_000);
  assert.equal(OFFER_CLIENT_TIMEOUT_MS, 25_000);
  assert.ok(OFFER_CLIENT_TIMEOUT_MS > OFFER_MODEL_TIMEOUT_MS);
  assert.ok(OFFER_CLIENT_TIMEOUT_MS < 30_000);
});

test("a 504 or a dropped connection asks to retry in Spanish", async () => {
  const steps = ["read", "504", "network"];
  for (const step of steps) {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      if (form.get("step") === "read" && step !== "network") {
        return new Response(
          JSON.stringify({ text: "Oferta Fertilidad. Precio USD 10000.", needsModelFile: false }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (step === "network") throw new TypeError("Failed to fetch");
      return new Response("An error occurred with your deployment\nFUNCTION_INVOCATION_TIMEOUT", {
        status: 504,
      });
    }) as typeof fetch;
    await assert.rejects(
      () =>
        runOfferExtraction(
          { paste: "Oferta Fertilidad Consciente con precio y comisión por escribir." },
          fetchImpl,
        ),
      /La extracción tardó demasiado y se cortó\. Pulsa Reintentar\./,
    );
  }
});

test("a body that arrives after the timeout is not the extracted offer", async () => {
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const form = init?.body as FormData;
    if (form.get("step") === "read") {
      return new Response(
        JSON.stringify({ text: "Oferta Fertilidad. Precio USD 10000.", needsModelFile: false }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    return new Response(
      JSON.stringify({
        offers: [{
          productName: "Tarde",
          productDescription: "Esto llegó después del corte de tiempo.",
          pitchSummary: "",
          icp: "",
          commercial: {},
        }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  await assert.rejects(
    () =>
      runOfferExtraction(
        { paste: "Oferta Fertilidad Consciente con precio y comisión por escribir." },
        fetchImpl,
        20,
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Pulsa Reintentar/);
      assert.equal(error.message.includes("Tarde"), false);
      return true;
    },
  );
});

test("a multi-page offer PDF becomes text and is not sent as a binary", async () => {
  const buffer = simplePdf([
    "Fertilidad Consciente lista USD 11800",
    "Contado especial USD 10000 reserva USD 2000",
  ]);
  const read = await textFromOfferFiles([
    { name: "oferta-fertilidad-consciente.pdf", mime: "application/pdf", buffer },
  ]);
  assert.match(read.text, /Fertilidad Consciente/);
  assert.match(read.text, /11800|10000/);
  assert.equal(read.binaries.length, 0);
});

test("a short payment is not an offer and No especificado is never proposed", () => {
  assert.equal(looksLikeOfferBlob("Valeria Ríos pagó la primera cuota de 533"), false);
  assert.equal(looksLikeOfferBlob("¿Qué tengo pendiente hoy?"), false);
  const pasted = `Qué vendes: Fertilidad Consciente.
Precio de lista USD 1597. Contado USD 1200.
Comisión 10% sobre lo cobrado.
${"El programa incluye acompañamiento. ".repeat(8)}`;
  assert.equal(looksLikeOfferBlob(pasted), true);
  const recap = offerBatchRecap({
    assumption: "una",
    questions: ["No encontré un porcentaje de comisión. ¿La dejo vacía?"],
    offers: [
      {
        productName: "No especificado",
        productDescription: "",
        pitchSummary: "",
        icp: "",
        commercial: emptyCommercial(),
      },
    ],
  });
  assert.doesNotMatch(recap, /No especificado/);
});
