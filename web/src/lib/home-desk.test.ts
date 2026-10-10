import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildExtractorPattern,
  gapWeekCounts,
  matchesLearnedNonCommercial,
} from "./extractor-feedback";
import {
  analyzeCardStatus,
  coachCardStatus,
  followupCardStatus,
  clientPatternPhrase,
  practiceCardFromGuides,
  spokenPracticeFocus,
} from "./home-desk";
import { quickFollowupIso } from "./followup-date";

test("ten Impromptu corrections become a non-commercial rule", () => {
  const rows = Array.from({ length: 10 }, () => ({
    campo: "estado_agenda",
    valorCorregido: "NO_COMERCIAL",
    title: "Impromptu Google Meet Meeting",
  }));
  const pattern = buildExtractorPattern(rows);
  assert.equal(pattern.rules[0]?.token, "impromptu");
  assert.match(pattern.summary, /no comercial/i);
  assert.equal(
    matchesLearnedNonCommercial("Impromptu Google Meet Meeting", pattern),
    true,
  );
  assert.equal(matchesLearnedNonCommercial("Cierre con Ana", pattern), false);
});

test("nine corrections do not auto-classify yet", () => {
  const rows = Array.from({ length: 9 }, () => ({
    campo: "estado_agenda",
    valorCorregido: "NO_COMERCIAL",
    title: "Impromptu Google Meet Meeting",
  }));
  const pattern = buildExtractorPattern(rows);
  assert.equal(pattern.rules.length, 0);
  assert.equal(matchesLearnedNonCommercial("Impromptu", pattern), false);
});

test("home cards keep a status line even when nothing is pending", () => {
  assert.equal(analyzeCardStatus(5), "5 sin clasificar");
  assert.equal(analyzeCardStatus(0), "Todo al día");
  assert.equal(followupCardStatus(4, 1), "4 pendientes de hoy · 1 atrasado");
  assert.equal(followupCardStatus(0, 3), "3 atrasados");
  assert.equal(followupCardStatus(1, 0), "1 pendiente de hoy");
  assert.equal(followupCardStatus(0, 0), "Todo al día");
  assert.equal(coachCardStatus({ newPattern: true, analyzedThisWeek: 2 }), "Nuevo patrón detectado");
  assert.equal(
    coachCardStatus({ newPattern: false, analyzedThisWeek: 2 }),
    "2 llamadas analizadas esta semana",
  );
  assert.equal(coachCardStatus({ newPattern: false, analyzedThisWeek: 0 }), "Sin novedades");
});

test("gap weeks split Monday to Monday", () => {
  const now = new Date("2026-09-22T15:00:00.000Z");
  const counts = gapWeekCounts(
    [
      new Date("2026-09-22T12:00:00.000Z"),
      new Date("2026-09-21T12:00:00.000Z"),
      new Date("2026-09-16T12:00:00.000Z"),
      new Date("2026-09-15T12:00:00.000Z"),
    ],
    now,
  );
  assert.equal(counts.thisWeek, 2);
  assert.equal(counts.lastWeek, 2);
});

test("the practice card keeps the drill off the hub payload", () => {
  const card = practiceCardFromGuides([
    { drills: ["  ", "resolver el precio antes de cerrar"], ready: true },
    { drills: ["otro ejercicio"], ready: false },
  ]);
  assert.equal(
    card.practiceHref,
    `/practicar?focus=${encodeURIComponent("resolver el precio antes de cerrar")}`,
  );
  assert.equal(card.practiceStatus, "resolver el precio antes de cerrar");
  assert.equal(card.newPattern, true);
  const pattern = practiceCardFromGuides([
    {
      drills: ["resolver el precio antes de cerrar"],
      missingInLosses: ["lo tengo que consultar"],
      ready: true,
    },
  ]);
  assert.equal(pattern.pattern, "Pierdes cierres cuando te dicen “lo tengo que consultar”");
  assert.equal(
    clientPatternPhrase("Manejo efectivo de la objeción de necesitar consultarlo con alguien"),
    "lo tengo que consultar",
  );
  assert.equal(
    practiceCardFromGuides([
      {
        drills: ["Manejo efectivo de la objeción de necesitar consultarlo con alguien"],
        missingInLosses: ["Manejo efectivo de la objeción de necesitar consultarlo con alguien"],
      },
    ]).pattern,
    "Pierdes cierres cuando te dicen “lo tengo que consultar”",
  );
  assert.equal(clientPatternPhrase("Manejo efectivo del silencio en el cierre"), "");
  assert.equal(
    practiceCardFromGuides([{ drills: ["solo el ejercicio"], missingInLosses: ["Manejo efectivo del silencio en el cierre"] }])
      .pattern,
    "",
  );
  assert.equal(pattern.drill, "resolver el precio antes de cerrar");
  assert.equal(
    pattern.practiceHref,
    `/practicar?focus=${encodeURIComponent("lo tengo que consultar")}`,
  );
  assert.equal(spokenPracticeFocus("lo tengo que consultar"), "lo tengo que consultar");
  assert.equal(spokenPracticeFocus("resolver el precio antes de cerrar"), "");
  assert.equal(practiceCardFromGuides([{ drills: ["solo el ejercicio"], missingInLosses: [] }]).pattern, "");
  const empty = practiceCardFromGuides([{ drills: [], ready: false }]);
  assert.equal(empty.practiceHref, "/practicar");
  assert.equal(empty.practiceStatus, "Elige con quién practicar");
  assert.equal(empty.newPattern, false);
  const hub = readFileSync(new URL("../app/api/hub/route.ts", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../components/home-screen.tsx", import.meta.url), "utf8");
  const inicio = readFileSync(new URL("../components/inicio-home.tsx", import.meta.url), "utf8");
  const practice = readFileSync(new URL("../app/api/hub/practice/route.ts", import.meta.url), "utf8");
  assert.equal(hub.includes("loadLiveGuides"), false);
  assert.equal(hub.includes("practiceCardFromGuides"), false);
  // «Lo que más te frena» loads the drill after the hub, and hides without a pattern.
  assert.match(inicio, /\/api\/hub\/practice/);
  assert.match(inicio, /Lo que más te frena/);
  assert.match(inicio, /card\.pattern/);
  assert.match(inicio, /Empieza en 3 pasos/);
  assert.match(inicio, /Qué le mandas a/);
  assert.match(inicio, /min-w-0/);
  assert.doesNotMatch(screen, /phase \|\| "a"/);
  assert.match(practice, /practiceCardFromGuides/);
  assert.match(practice, /select: \{ productName: true, playbook: true \}/);
});

test("the practice row keeps the full drill so line-clamp can ellipsize", () => {
  const drill =
    "Reconoce, Relaciona y Devuelve la pregunta durante el silencio y relaciona el dolor con el precio antes de pedir la decisión";
  const card = practiceCardFromGuides([{ drills: [drill], ready: true }]);
  assert.equal(card.practiceStatus, drill);
  assert.ok(card.practiceStatus.length > 90);
  assert.equal(card.practiceStatus.endsWith("…"), false);
  assert.equal(card.practiceStatus.endsWith(" el"), false);
  assert.equal(
    card.practiceHref,
    `/practicar?focus=${encodeURIComponent(drill)}`,
  );
  const source = readFileSync(new URL("./home-desk.ts", import.meta.url), "utf8");
  assert.equal(source.includes("clipWords"), false);
});

test("quick follow-up chips land on real days", () => {
  const thursday = new Date("2026-09-17T18:00:00.000Z");
  assert.equal(quickFollowupIso("hoy", thursday), "2026-09-17");
  assert.equal(quickFollowupIso("manana", thursday), "2026-09-18");
  assert.equal(quickFollowupIso("semana", thursday), "2026-09-18");
});
