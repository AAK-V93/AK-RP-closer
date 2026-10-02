import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_FOLLOWUP_PACKS } from "./followup-catalog";
import {
  collectionCopy,
  DEFAULT_FOLLOWUP_SCRIPTS,
  fillFollowupGuion,
  nextCuotaAmount,
  type FollowupVars,
} from "./followup-scripts";
import { scriptMatchesOffer } from "./followup-library";

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
  assert.match(video?.recomendacion || "", /presentación/);
  assert.match(video?.guion || "", /Admisión/);
  assert.doesNotMatch(video?.guion || "", /Admision/);
});

test("an empty closer is removed and another offer's script is not suggested", () => {
  const filled = fillFollowupGuion("Hola [Nombre], soy [CLOSER]. Bienvenida a [PROGRAMA].", {
    ...VARS,
    nombre: "Valeria",
    closer: "",
    programa: "Fertilidad Consciente",
  });
  assert.equal(filled, "Hola Valeria, Bienvenida a Fertilidad Consciente.");
  assert.doesNotMatch(filled, /\[CLOSER\]/);
  const segunda = DEFAULT_FOLLOWUP_SCRIPTS.find((row) => row.key === "segunda_reunion");
  assert.doesNotMatch(segunda?.recomendacion || "", /Reprogramó/);
  const video = BUILTIN_FOLLOWUP_PACKS.flatMap((pack) => pack.scripts).find((row) => row.key === "video");
  assert.equal(scriptMatchesOffer(video?.guion || "", "Fertilidad Consciente"), false);
  assert.equal(scriptMatchesOffer("Hola [Nombre], ¿cómo vas con [PROGRAMA]?", "Fertilidad Consciente"), true);
});

test("a future cuota uses the next installment, not the whole balance, and skips empty payment data", () => {
  const script = DEFAULT_FOLLOWUP_SCRIPTS.find((row) => row.key === "dia_pago");
  const money = collectionCopy({
    saldo: 1064,
    due: "2026-10-09",
    today: "2026-10-02",
    paymentDetails: "",
    hints: [{ label: "3 cuotas de", amount: 533 }],
  });
  assert.equal(money.monto, "533");
  assert.equal(money.saldo, "1064");
  assert.equal(nextCuotaAmount(400, [{ label: "3 cuotas de", amount: 533 }]), 400);
  const text = fillFollowupGuion(script?.guion || "", {
    ...VARS,
    nombre: "Valeria",
    programa: "Fertilidad Consciente",
    ...money,
  });
  assert.match(text, /el 9 de octubre te toca el pago de USD 533/);
  assert.match(text, /Fertilidad Consciente/);
  assert.doesNotMatch(text, /1064|hoy corresponde|Te dejo los datos/);
  const today = collectionCopy({
    saldo: 1064,
    due: "2026-10-02",
    today: "2026-10-02",
    paymentDetails: "BCP 191-123",
    hints: [{ label: "3 cuotas de", amount: 533 }],
  });
  const dueToday = fillFollowupGuion(script?.guion || "", {
    ...VARS,
    nombre: "Valeria",
    programa: "Fertilidad Consciente",
    ...today,
  });
  assert.match(dueToday, /hoy te toca el pago de USD 533/);
  assert.match(dueToday, /Te dejo los datos: BCP 191-123/);
});
