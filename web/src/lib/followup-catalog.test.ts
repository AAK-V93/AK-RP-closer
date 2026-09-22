import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_FOLLOWUP_PACKS } from "./followup-catalog";
import { fillFollowupGuion, type FollowupVars } from "./followup-scripts";

const VARS: FollowupVars = {
  nombre: "Ana",
  programa: "Mentoría Norte",
  monto: "500",
  saldo: "200",
  fecha: "2026-09-22",
  pago: "https://pago.example",
  objecion: "",
  deseo: "una empresa que funciona sin él",
  closer: "Luis",
};

test("catalog ships both follow-up packs with blue text as placeholders", () => {
  const titles = BUILTIN_FOLLOWUP_PACKS.map((pack) => pack.title);
  assert.deepEqual(titles, ["Creativos", "De valor"]);
  const scripts = BUILTIN_FOLLOWUP_PACKS.flatMap((pack) => pack.scripts);
  assert.equal(scripts.length, 27);
  assert.ok(scripts.every((row) => row.guion.includes("[Nombre]")));
  const premonicion = scripts.find((row) => row.key === "sone-contigo-tuve-una-premonicion");
  assert.ok(premonicion);
  assert.match(premonicion.guion, /\[PROGRAMA\]/);
  assert.match(premonicion.guion, /\[organizada\]/);
  assert.doesNotMatch(premonicion.guion, /Nombre del empresario/);
  const filled = fillFollowupGuion(premonicion.guion, VARS);
  assert.match(filled, /Ana/);
  assert.match(filled, /Mentoría Norte/);
  assert.match(filled, /\[organizada\]/);
  const noticia = scripts.find((row) => row.key === "noticia-de-ultimo-minuto");
  assert.equal(
    fillFollowupGuion(noticia?.guion || "", VARS).includes("una empresa que funciona sin él"),
    true,
  );
  const video = scripts.find((row) => row.key === "video");
  assert.match(fillFollowupGuion(video?.guion || "", VARS), /Luis/);
  assert.match(fillFollowupGuion(video?.guion || "", VARS), /2026-09-22/);
  const frio = scripts.find((row) => row.key === "llamada-en-frio");
  assert.equal(frio?.canal, "LLAMADA");
  assert.match(frio?.guion || "", /\[¿Qué falta para que hagamos la inscripción\?\]/);
});
