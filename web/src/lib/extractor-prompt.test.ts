import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildExtractorPrompt,
  PAE_APPENDIX_MARKER,
  renderPaeProtocol,
} from "./extractor";
import { emptyCommercial, type OfferForCrm } from "./offer-commercial";
import { PROTOCOLO_EXTRACTOR_COMERCIAL_PAE } from "./protocolo-extractor-comercial-pae";

const PRODUCT_LIST =
  /MILLONARIOS 360\r?\nINGRESOS 360\r?\nDESPEGA TU NEGOCIO\r?\nCOACHING\r?\nMENTORIAS\r?\nGIRAS\r?\nOTROS/;
const PAYMENT_LIST = /CONTADO\r?\n4 CUOTAS\r?\n6 CUOTAS\r?\n8 CUOTAS\r?\n12 CUOTAS\r?\nRESERVA/;

function offer(
  productName: string,
  aliases: string[] = [],
  paymentModes: { name: string; details: string }[] = [],
): OfferForCrm {
  return {
    id: productName,
    productName,
    productDescription: "",
    commercial: { ...emptyCommercial(), aliases, paymentModes },
  };
}

const originalCatalog: OfferForCrm[] = [
  "MILLONARIOS 360",
  "INGRESOS 360",
  "DESPEGA TU NEGOCIO",
  "COACHING",
  "MENTORIAS",
  "GIRAS",
  "OTROS",
].map((productName, index) =>
  offer(
    productName,
    [],
    index === 0
      ? ["CONTADO", "4 CUOTAS", "6 CUOTAS", "8 CUOTAS", "12 CUOTAS", "RESERVA"].map((name) => ({
          name,
          details: "",
        }))
      : [],
  ),
);

test("el texto embebido es el txt del protocolo, byte a byte", () => {
  const txt = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "protocolo-extractor-comercial-pae.txt"),
    "utf8",
  );
  assert.equal(PROTOCOLO_EXTRACTOR_COMERCIAL_PAE, txt);
});

test("con el catálogo original, la sección PAE es el documento línea por línea", () => {
  assert.equal(renderPaeProtocol(originalCatalog), PROTOCOLO_EXTRACTOR_COMERCIAL_PAE);
});

test("solo se sustituyen las listas de productos y de pago", () => {
  const offers = [
    offer("Alpha", ["alfa", "el intensivo"], [{ name: "Transferencia", details: "mitad ahora" }]),
    offer("Beta", [], [{ name: "Tarjeta", details: "" }]),
  ];
  const rendered = renderPaeProtocol(offers);
  const originalProducts = PROTOCOLO_EXTRACTOR_COMERCIAL_PAE.match(PRODUCT_LIST)?.[0];
  const originalPayments = PROTOCOLO_EXTRACTOR_COMERCIAL_PAE.match(PAYMENT_LIST)?.[0];
  assert.ok(originalProducts);
  assert.ok(originalPayments);

  const productNeedle = "Alpha (alias: alfa, el intensivo)\nBeta".replace(/\n/g, originalProducts.includes("\r\n") ? "\r\n" : "\n");
  const paymentNeedle = ["Transferencia — mitad ahora", "Tarjeta"].join(
    originalPayments.includes("\r\n") ? "\r\n" : "\n",
  );
  const [beforeProduct, afterProduct] = rendered.split(productNeedle);
  const [between, afterPayment] = afterProduct.split(paymentNeedle);
  const [originalBeforeProduct, originalAfterProduct] =
    PROTOCOLO_EXTRACTOR_COMERCIAL_PAE.split(originalProducts);
  const [originalBetween, originalAfterPayment] = originalAfterProduct.split(originalPayments);

  assert.equal(beforeProduct, originalBeforeProduct);
  assert.equal(between, originalBetween);
  assert.equal(afterPayment, originalAfterPayment);
  assert.equal(rendered.includes("MILLONARIOS 360"), false);
  assert.equal(rendered.includes("4 CUOTAS"), false);
  assert.equal(rendered.includes("ACUERDO SIN PAGO"), false);
  assert.equal(rendered.includes("NO_COMERCIAL"), false);
  assert.equal(rendered.includes("calificado"), false);
});

test("los campos de la app van después del protocolo, no adentro", () => {
  const prompt = buildExtractorPrompt({
    offers: [offer("Alpha", ["alfa"], [{ name: "Transferencia", details: "" }])],
    title: "Llamada.vtt",
    fechaLlamada: "2026-09-01",
    transcript: "cierre de la llamada",
    readyCrm: true,
    hints: "Si dice beca, el producto es Alpha.",
  });
  const cut = prompt.indexOf(PAE_APPENDIX_MARKER);
  assert.ok(cut > 0);
  const pae = prompt.slice(0, cut).replace(/\n+$/, "");
  assert.equal(pae, renderPaeProtocol([offer("Alpha", ["alfa"], [{ name: "Transferencia", details: "" }])]));
  assert.ok(pae.endsWith("Y solo entonces genera el JSON."));
  for (const field of [
    "AGENDADO",
    "ACUERDO SIN PAGO",
    "INTERNA",
    "NO_COMERCIAL",
    "calificado",
    "razon_no_cierre",
    "etapa_perdida",
    "canal_contacto",
    "telefono",
    "email",
    "FECHA_LLAMADA: 2026-09-01",
    "CORRECCIONES DE ESTE CLOSER",
  ]) {
    assert.ok(prompt.indexOf(field) > cut, field);
  }
  assert.ok(prompt.trimEnd().endsWith("cierre de la llamada"));
});
