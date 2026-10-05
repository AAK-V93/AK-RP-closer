import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { prioritizeDesk } from "./crm-followups";
import {
  bogotaDateLine,
  bogotaMonthName,
  buildInicioList,
  followupChip,
  goalProgress,
  monthCommissionUsd,
  nextStepText,
  offerRules,
  paraLlegarLines,
  rankFollowups,
  rowCommissionUsd,
  type InicioFollowupSource,
} from "./inicio-view";
import { MOBILE_TABS, MORE_LINKS, moreActive, navActive, visibleTabs } from "./mobile-nav";

// Sunday 4 October 2026, 8:00 pm in Bogotá (already the 5th in UTC).
const NOW = new Date("2026-10-05T01:00:00Z");

const commission = (pct: number) => ({
  notes: `${pct * 100}% del cash cobrado`,
  tiers: [],
  pctBase: pct,
  base: "cash_collected",
  periodoAcumulacion: "mensual",
});
const RULES = offerRules([
  { productName: "Círculo Millonario", commercial: { listPrice: 9000, currency: "USD", commission: commission(0.1) } },
  { productName: "Sin Regla", commercial: { listPrice: 500, currency: "USD" } },
]);

function row(id: string, extra: Partial<InicioFollowupSource>): InicioFollowupSource {
  return { id, cliente: id, oferta: "Círculo Millonario", dueAt: "2026-10-04T20:00:00.000Z", ...extra };
}

const ROWS: InicioFollowupSource[] = [
  row("Ana Ruiz", { proximo: "2026-10-04", enJuego: 0 }),
  row("Beto Paz", { proximo: "2026-09-29", enJuego: 9000, telefono: "+57 300 111 2233" }),
  row("Carla Gil", { proximo: "2026-10-04 15:00", enJuego: 1800 }),
  row("Dani Mora", { proximo: "2026-10-05 10:00", enJuego: 9000 }),
  row("Elsa Vega", { proximo: "2026-10-08", enJuego: 0 }),
  row("Fede Sol", { proximo: "2026-10-03", enJuego: 0 }),
  row("Gina Luz", { proximo: "2026-10-20", enJuego: 600 }),
];

test("Inicio list: money first, then days late, later dates after, cut at five", () => {
  const ranked = rankFollowups(ROWS, NOW).map((item) => item.cliente);
  assert.deepEqual(ranked, ["Beto Paz", "Carla Gil", "Fede Sol", "Ana Ruiz", "Dani Mora", "Elsa Vega", "Gina Luz"]);
  const list = buildInicioList({ followups: ROWS, rules: RULES, now: NOW });
  assert.equal(list.rows.length, 5);
  assert.deepEqual(
    list.rows.map((item) => item.name),
    ["Beto Paz", "Carla Gil", "Fede Sol", "Ana Ruiz", "Dani Mora"],
  );
  assert.equal(list.more, 2);
  assert.equal(list.total, 7);
});

test("Inicio list agrees with «¿A quién llamo hoy?» for today and late rows", () => {
  const due = ROWS.filter((item) => String(item.proximo) <= "2026-10-04 23:59");
  const desk = prioritizeDesk(
    due.map((item) => {
      const day = String(item.proximo).slice(0, 10);
      const late = Math.round((Date.parse("2026-10-04") - Date.parse(day)) / 86_400_000);
      return {
        name: item.cliente,
        step: "",
        date: day,
        estado: late > 0 ? "VENCIDO" : "HOY",
        amount: item.enJuego || 0,
        lateDays: late,
        reason: "",
        kind: "llamada",
      };
    }),
  ).map((line) => line.name);
  const ranked = rankFollowups(due, NOW).map((item) => item.cliente);
  assert.deepEqual(ranked, desk);
});

test("chip: amber today with the hour, rose for days without an answer, grey later", () => {
  assert.deepEqual(followupChip({ proximo: "2026-10-04 15:00" }, NOW), { tone: "today", label: "Hoy 3:00 pm" });
  assert.deepEqual(followupChip({ proximo: "2026-10-04" }, NOW), { tone: "today", label: "Hoy" });
  assert.deepEqual(followupChip({ proximo: "2026-09-29" }, NOW), {
    tone: "late",
    label: "Hace 5 días sin respuesta",
  });
  assert.deepEqual(followupChip({ proximo: "2026-10-03" }, NOW), { tone: "late", label: "Hace 1 día sin respuesta" });
  assert.deepEqual(followupChip({ proximo: "2026-10-05 10:00" }, NOW), {
    tone: "future",
    label: "Mañana 10:00 am",
  });
  assert.deepEqual(followupChip({ proximo: "2026-10-06 11:30" }, NOW), {
    tone: "future",
    label: "Martes 6 oct 11:30 am",
  });
  // A bare day falls back to the alert instant, read in Bogotá.
  assert.equal(followupChip({ dueAt: "2026-10-05T02:00:00.000Z" }, NOW).tone, "today");
  for (const item of ROWS) {
    assert.doesNotMatch(followupChip(item, NOW).label, /vencid/i);
  }
});

test("qué quedó never says «vencido»", () => {
  assert.equal(nextStepText(row("x", { acuerdo: "", proximaAccion: "Seguimiento · vencido" })), "Retomar el contacto");
  assert.equal(nextStepText(row("x", { acuerdo: "llamarlo el lunes para cerrar" })), "Llamarlo el lunes para cerrar");
  assert.equal(nextStepText(row("x", { proximaAccion: "Enviar link de pago · vencido" })), "Enviar link de pago");
  assert.equal(
    nextStepText(row("x", { callAcuerdo: "Quedó en revisarlo con su contador", acuerdo: "enviar mensaje · vencido" })),
    "Quedó en revisarlo con su contador",
  );
});

test("goal: whole percent, capped bar and the days after today", () => {
  const goal = goalProgress({ llevasUsd: 1240, metaUsd: 3000, now: NOW });
  assert.equal(goal.pct, 41);
  assert.equal(goal.barPct, 41);
  assert.equal(goal.daysLeft, 27);
  assert.equal(goal.daysLabel, "Quedan 27 días");
  const over = goalProgress({ llevasUsd: 3600, metaUsd: 3000, now: NOW });
  assert.equal(over.pct, 120);
  assert.equal(over.barPct, 100);
  const none = goalProgress({ llevasUsd: 500, metaUsd: null, now: NOW });
  assert.equal(none.pct, null);
  assert.equal(none.metaUsd, null);
  const last = goalProgress({ llevasUsd: 0, metaUsd: 1000, now: new Date("2026-10-31T20:00:00Z") });
  assert.equal(last.daysLeft, 0);
  assert.equal(last.daysLabel, "Hoy es el último día del mes");
});

test("date line and month in Bogotá time", () => {
  assert.equal(bogotaDateLine(NOW), "Domingo 4 de octubre");
  assert.equal(bogotaMonthName(NOW), "octubre");
});

test("commission this month only counts October in Bogotá", () => {
  const total = monthCommissionUsd(
    [
      { fecha: "2026-10-02T15:00:00.000Z", generada: 900 },
      { fecha: "2026-10-04T23:00:00.000Z", generada: 340 },
      { fecha: "2026-10-01T03:00:00.000Z", generada: 500 }, // 30 Sep at 10 pm in Bogotá
    ],
    NOW,
  );
  assert.equal(total, 1240);
});

test("commission is hidden when it is not really known", () => {
  assert.equal(rowCommissionUsd({ enJuego: 9000, offer: "Círculo Millonario", rules: RULES }), 900);
  assert.equal(rowCommissionUsd({ enJuego: 9000, offer: "Sin Regla", rules: RULES }), null);
  assert.equal(rowCommissionUsd({ enJuego: 9000, offer: "Otra oferta", rules: RULES }), null);
  assert.equal(rowCommissionUsd({ enJuego: 0, offer: "Círculo Millonario", rules: RULES }), null);
  const list = buildInicioList({ followups: ROWS, rules: RULES, now: NOW });
  assert.equal(list.rows.find((item) => item.name === "Ana Ruiz")?.commissionUsd, null);
  assert.equal(list.rows.find((item) => item.name === "Beto Paz")?.commissionUsd, 900);
});

test("WhatsApp only with a phone", () => {
  const list = buildInicioList({ followups: ROWS, rules: RULES, now: NOW });
  assert.match(list.rows.find((item) => item.name === "Beto Paz")!.whatsappHref, /^https:\/\/wa\.me\/573001112233/);
  assert.equal(list.rows.find((item) => item.name === "Carla Gil")!.whatsappHref, "");
});

test("Para llegar hides the meetings line with assumed rates", () => {
  const base = {
    llevasUsd: 1240,
    metaUsd: 3000,
    offerName: "Círculo Millonario",
    lastClose: { days: 6, callsSince: 7 },
  };
  const real = paraLlegarLines({
    ...base,
    projection: { falta: 1760, cierres: 2, shows: 8, usedAssumedRates: false, rates: { pct: 0.25 } },
  });
  assert.equal(real.headline, "Te faltan 2 cierres de Círculo Millonario");
  assert.equal(real.meetings, "Con tu tasa actual son ≈ 8 reuniones");
  assert.equal(real.closeWhen, "Último cierre: hace 6 días");
  assert.equal(real.closeCalls, "7 llamadas desde entonces");
  const assumed = paraLlegarLines({
    ...base,
    projection: { falta: 1760, cierres: 2, shows: 8, usedAssumedRates: true, rates: { pct: 0.25 } },
  });
  assert.equal(assumed.meetings, "");
  const noGoal = paraLlegarLines({ ...base, metaUsd: null, projection: null, lastClose: null });
  assert.equal(noGoal.headline, "");
  assert.equal(noGoal.closeWhen, "");
});

test("Inicio no longer renders the loose chat or the push notice", () => {
  const screen = readFileSync(new URL("../components/home-screen.tsx", import.meta.url), "utf8");
  const inicio = readFileSync(new URL("../components/inicio-home.tsx", import.meta.url), "utf8");
  for (const source of [screen, inicio]) {
    assert.doesNotMatch(source, /<HubChat\b/);
    assert.doesNotMatch(source, /Para casos sueltos/);
    assert.doesNotMatch(source, /<PushEnable\b/);
    assert.doesNotMatch(source, /vencid/i);
  }
  assert.match(screen, /<InicioHome\b/);
  assert.match(inicio, /Tu lista de hoy/);
  assert.match(inicio, /Hoy no tienes seguimientos pendientes/);
  assert.match(inicio, /Ver en el CRM/);
});

test("phone tab bar: Inicio, Llamadas, Práctica, CRM and Más with Coach, Ofertas, Biblioteca", () => {
  assert.deepEqual(
    MOBILE_TABS.map((tab) => [tab.label, tab.href]),
    [
      ["Inicio", "/"],
      ["Llamadas", "/llamadas"],
      ["Práctica", "/practicar"],
      ["CRM", "/crm"],
    ],
  );
  assert.deepEqual(
    MORE_LINKS.map((tab) => [tab.label, tab.href]),
    [
      ["Coach", "/coach"],
      ["Ofertas", "/ofertas"],
      ["Biblioteca", "/biblioteca"],
    ],
  );
  assert.deepEqual(visibleTabs(false).map((tab) => tab.label), ["Inicio", "Llamadas", "Práctica"]);
  assert.equal(navActive("/", "/"), true);
  assert.equal(navActive("/crm", "/"), false);
  assert.equal(navActive("/coach/abc", "/coach"), true);
  assert.equal(moreActive("/ofertas"), true);
  assert.equal(moreActive("/crm"), false);

  const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /fixed inset-x-0 bottom-0 z-40[^"]*pb-\[env\(safe-area-inset-bottom\)\][^"]*md:hidden/);
  assert.match(shell, /pb-\[calc\(6rem\+env\(safe-area-inset-bottom\)\)\] md:pb-6/);
  assert.match(shell, /aria-\[current=page\]:font-semibold/);
  // Desktop keeps the pill menu; the phone no longer scrolls a pill row sideways.
  assert.match(shell, /hidden md:flex items-center gap-1 text-sm/);
  assert.doesNotMatch(shell, /overflow-x-auto/);
  const ask = readFileSync(new URL("../components/crm-ask.tsx", import.meta.url), "utf8");
  assert.match(ask, /bottom-\[calc\(4rem\+env\(safe-area-inset-bottom\)\)\] md:bottom-0/);
});
