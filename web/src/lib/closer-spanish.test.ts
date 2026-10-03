import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AAA_EVALUATOR_BRIEF, sectionEvalNotes } from "../data/rubric";
import { CLOSER_COACH_SYSTEM_PROMPT } from "./closer-coach-prompt";
import { closerSpanish, closerSpanishDeep, PLAIN_SPANISH_RULE } from "./closer-spanish";
import { buildQcReportPrompt } from "./qc-prompt";

const rubric =
  "Manejo de objeciones con marco 3A y calificación financiera previa al pitch";
const drill =
  "Responder por escrito a la objeción de presupuesto utilizando estrictamente el modelo Acknowledge, Associate y Ask Back.";
const analysis = "…haces pitches prematuros…";

test("stored coach jargon is Spanish at display time", () => {
  const rubricOut = closerSpanish(rubric);
  assert.equal(
    rubricOut,
    "Manejo de objeciones con marco de Reconoce, Relaciona y Devuelve la pregunta y calificación financiera antes de presentar la oferta",
  );
  assert.doesNotMatch(rubricOut, /\bpitch\b/i);

  const drillOut = closerSpanish(drill);
  assert.equal(
    drillOut,
    "Responder por escrito a la objeción de presupuesto utilizando estrictamente el modelo Reconoce, Relaciona y Devuelve la pregunta.",
  );
  assert.doesNotMatch(drillOut, /Acknowledge|Associate|Ask Back/);

  const analysisOut = closerSpanish(analysis);
  assert.equal(analysisOut, "…haces presentaciones de la oferta prematuras…");
  assert.doesNotMatch(analysisOut, /pitches|prematuros/);
});

test("phase ids and the plus-sign framework stay intact", () => {
  assert.equal(closerSpanish("discovery"), "descubrimiento");
  assert.equal(closerSpanish("pitch"), "presentación de la oferta");
  assert.equal(
    closerSpanish("Acknowledge + Associate + Ask Back"),
    "Reconoce + Relaciona + Devuelve la pregunta",
  );
  assert.equal(closerSpanish("use_discovery"), "use_discovery");
  assert.equal(closerSpanish("pitch_close"), "pitch_close");
  assert.equal(closerSpanish("Solo descubrimiento"), "Solo descubrimiento");
  assert.deepEqual(
    closerSpanishDeep({
      coverage: "pitch",
      id: "use_discovery",
      feedback: "haces pitches prematuros",
    }),
    {
      coverage: "pitch",
      id: "use_discovery",
      feedback: "haces presentaciones de la oferta prematuras",
    },
  );
});

test("generation prompts demand plain Spanish and keep the phase enum", () => {
  assert.match(CLOSER_COACH_SYSTEM_PROMPT, /Prohibido en esas frases/);
  assert.match(CLOSER_COACH_SYSTEM_PROMPT, /Alto desempeño/);
  assert.doesNotMatch(CLOSER_COACH_SYSTEM_PROMPT, /\bDiscovery\b|\bClosing\b/);

  const qc = buildQcReportPrompt({ transcript: "hola", speakers: [] });
  assert.match(qc, /antes de presentar la oferta/);
  assert.doesNotMatch(qc, /antes de pitchear|cómo se entregó el pitch/);
  assert.match(qc, /Prohibido en esas frases/);

  for (const section of ["discovery", "pitch", "close", "pitch_close", "full"]) {
    const note = sectionEvalNotes(section);
    assert.doesNotMatch(note, /\bpitch\b|\b3A\b/);
  }
  assert.doesNotMatch(AAA_EVALUATOR_BRIEF, /ACKNOWLEDGE|ASK BACK|\bpitch\b|seek to understand|I need to think/);
  assert.match(PLAIN_SPANISH_RULE, /discovery\|pitch\|close\|other/);

  const evaluate = readFileSync(new URL("../app/api/evaluate/route.ts", import.meta.url), "utf8");
  assert.match(evaluate, /PLAIN_SPANISH_RULE/);
  assert.match(evaluate, /"phase":"discovery\|pitch\|close\|other"/);
  const live = readFileSync(new URL("./live-guide.ts", import.meta.url), "utf8");
  assert.match(live, /PLAIN_SPANISH_RULE/);
  assert.match(live, /"drills"/);
});
