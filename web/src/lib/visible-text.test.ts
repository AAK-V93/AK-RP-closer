import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { displayCallTitle } from "./fathom-import";
import { clipVisible, mobileCellText, mobileDeskStatus, MOBILE_DESK_CHARS } from "./visible-text";

test("visible clips mark a cut and skip a dangling word", () => {
  const cut = clipVisible("Devuelve la pregunta durante el silencio largo", 32);
  assert.equal(cut.endsWith("…"), true);
  assert.equal(cut.endsWith(" el…"), false);
  assert.equal(cut.endsWith(" de…"), false);
  assert.equal(cut.endsWith(" la…"), false);
  assert.equal(clipVisible("Mentoría", 40), "Mentoría");
});

test("the phone desk row clips with an explicit ellipsis", () => {
  const drill =
    "Practica el ejercicio de Reconoce, Relaciona y Devuelve la pregunta durante el silencio";
  const mobile = mobileDeskStatus(drill);
  assert.ok(MOBILE_DESK_CHARS >= 60 && MOBILE_DESK_CHARS <= 70);
  assert.equal(mobile.endsWith("…"), true);
  assert.ok(mobile.length <= MOBILE_DESK_CHARS + 1);
  assert.equal(mobile.endsWith(" el…"), false);
  assert.equal(mobile.endsWith(" de…"), false);
  assert.equal(mobile.endsWith(" la…"), false);
  assert.equal(mobile.includes("durante el silencio"), false);
  assert.equal(mobileDeskStatus("Todo al día"), "Todo al día");
  assert.equal(mobileDeskStatus("Elige con quién practicar"), "Elige con quién practicar");
  const row = readFileSync(new URL("../components/desk-row-status.tsx", import.meta.url), "utf8");
  assert.match(row, /sm:hidden/);
  assert.match(row, /hidden text-left sm:line-clamp-2/);
  assert.doesNotMatch(row, /text-right/);
  assert.match(row, /mobileDeskStatus/);
  assert.match(row, /title=\{status\}/);
});

test("a phone CRM cell clips prose and keeps lead and offer names", () => {
  const note = "Preguntar si ya evaluó la propuesta con su equipo comercial antes de cerrar";
  assert.equal(mobileCellText("notas", note, true).endsWith("…"), true);
  assert.equal(mobileCellText("notas", note, false), note);
  assert.equal(mobileCellText("cliente", "Sofía Mamani Quispe de la Torre", true), "Sofía Mamani Quispe de la Torre");
  assert.equal(
    mobileCellText("oferta", "Mentoría de Alto Valor para Equipos Comerciales", true),
    "Mentoría de Alto Valor para Equipos Comerciales",
  );
  assert.equal(mobileCellText("producto", "Fertilidad Consciente Sistema", true), "Fertilidad Consciente Sistema");
});

test("screens the closer sees do not say vencid", () => {
  const files = [
    "../components/inicio-home.tsx",
    "../components/home-screen.tsx",
    "../components/crm-ask.tsx",
    "../components/app-shell.tsx",
    "../app/crm/page.tsx",
    "../lib/home-desk.ts",
    "../lib/plain-labels.ts",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8")
      .replace(/\bseguimientosVencidos\b/g, "")
      .replace(/\bCOBRO_VENCIDO\b/g, "")
      .replace(/\bVENCIDO\b/g, "");
    const hit = source.match(/[^\n]{0,60}vencid[^\n]{0,60}/i);
    assert.equal(hit, null, `${file}: ${hit?.[0] || ""}`);
  }
  assert.equal(mobileDeskStatus("3 atrasados").includes("vencid"), false);
});

test("call titles keep the lead and the offer whole", () => {
  const lead = "Sofía Mamani Quispe de la Torre";
  const offer = "Mentoría de Alto Valor para Equipos Comerciales";
  assert.equal(displayCallTitle({ leadName: lead, offerName: offer }), `${lead} · ${offer}`);
  assert.equal(displayCallTitle({ leadName: lead }), lead);
  assert.equal(displayCallTitle({ offerName: offer }), offer);
});
