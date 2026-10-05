import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { answerCrmFollowups, type CrmAskRow } from "./crm-ask";

const now = new Date(2026, 9, 1, 15, 0, 0);

function at(day: number, hour = 12): string {
  return new Date(2026, 9, day, hour, 0, 0).toISOString();
}

const rows: CrmAskRow[] = [
  {
    id: "1",
    cliente: "María Pérez",
    dueAt: at(1, 9),
    hilo: "DECISION",
    paso: "2 de 4",
    ultimoToque: "hace 6 días · no contestó",
    proximaAccion: "Cobrar decisión · pendiente de hoy",
    canal: "WHATSAPP",
    telefono: "+50760001111",
    oferta: "Alpha",
    mensajeSugerido: "María, ¿lo hablaste con tu esposo?",
    enJuego: 1300,
  },
  {
    id: "2",
    cliente: "Luis Gómez",
    dueAt: at(2, 11),
    hilo: "COBRANZA",
    paso: "1 de 7",
    proximaAccion: "Bienvenida",
    canal: "LLAMADA",
    oferta: "Alpha",
    enJuego: 800,
  },
  {
    id: "3",
    cliente: "Ana Ruiz",
    dueAt: at(20, 11),
    hilo: "RETOMAR",
    paso: "1 de 3",
    proximaAccion: "Retomar cuando tenga liquidez",
    canal: "WHATSAPP",
  },
];

test("answers who is due today from the CRM rows", () => {
  const text = answerCrmFollowups(rows, "¿a quién hoy?", { now });
  assert.match(text, /María Pérez/);
  assert.match(text, /WhatsApp/);
  assert.equal(text.includes("Ana Ruiz"), false);
  assert.equal(text.includes("Luis Gómez"), false);
});

test("answers when and how for one person, including the script", () => {
  const text = answerCrmFollowups(rows, "¿cómo le escribo a María?", {
    now,
    money: (value) => `USD ${value}`,
  });
  assert.match(text, /María Pérez/);
  assert.match(text, /Cuándo: hoy, pendiente/);
  assert.match(text, /Cómo: WhatsApp · Cobrar decisión/);
  assert.match(text, /\+50760001111/);
  assert.match(text, /En juego: USD 1300/);
  assert.match(text, /María, ¿lo hablaste con tu esposo\?/);
  assert.equal(text.includes("Luis"), false);
});

test("says when a name is not in the CRM", () => {
  const text = answerCrmFollowups(rows, "¿cuándo le escribo a Pedro?", { now });
  assert.match(text, /No tengo un seguimiento de pedro/);
  assert.equal(text.includes("María"), false);
});

test("tomorrow lists only that day", () => {
  const text = answerCrmFollowups(rows, "¿a quién mañana?", { now });
  assert.match(text, /Luis Gómez/);
  assert.equal(text.includes("María"), false);
  assert.equal(text.includes("Ana"), false);
});

test("a list bullet does not repeat seguimiento and atrasado", () => {
  const text = answerCrmFollowups(
    [
      {
        id: "e",
        cliente: "Elber",
        dueAt: new Date(2026, 8, 23, 13, 0, 0).toISOString(),
        hilo: "SEGUIMIENTO",
        proximaAccion: "seguimiento · atrasado",
        canal: "WHATSAPP",
        proximo: "2026-09-23",
      },
    ],
    "¿A quién llamo hoy?",
    { now },
  );
  assert.match(text, /Elber/);
  assert.match(text, /pendiente desde/);
  assert.match(text, /WhatsApp/);
  assert.equal((text.match(/seguimiento/gi) || []).length, 1);
  assert.equal(/atrasado/i.test(text), false);
});

test("empty CRM does not invent a follow-up", () => {
  assert.equal(
    answerCrmFollowups([], "¿a quién hoy?", { now }),
    "No hay seguimientos abiertos en el CRM.",
  );
});

test("the ask panel is a side column at 1200px and a 64px bar below that", () => {
  const ask = readFileSync(new URL("../components/crm-ask.tsx", import.meta.url), "utf8");
  const crm = readFileSync(new URL("../app/crm/page.tsx", import.meta.url), "utf8");
  assert.match(ask, /min-width: 1200px/);
  assert.equal(ask.includes("min-width: 1280px"), false);
  assert.match(ask, /min-\[1200px\]:sticky min-\[1200px\]:top-4/);
  assert.match(ask, /flex h-16 max-h-16 min-w-0 items-center gap-2 border-t border-separator1 px-3 min-\[1200px\]:hidden/);
  assert.match(ask, /min-\[1200px\]:hidden/);
  assert.match(crm, /min-\[1200px\]:grid min-\[1200px\]:grid-cols-\[minmax\(0,1fr\)_320px\]/);
  assert.equal(crm.includes("xl:grid xl:grid-cols-[minmax(0,1fr)_320px]"), false);
});
