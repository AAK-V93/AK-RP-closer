import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compareFollowupRank, followupRankInput, openFollowupCountOf, pickOpenByName, prioritizeDesk } from "./crm-followups";
import { answerCrmFollowups } from "./crm-ask";
import {
  bogotaDateLine,
  bogotaMonthName,
  buildInicioList,
  closerFacingNote,
  cutAtWord,
  followupChip,
  followupWhenParts,
  secondPersonCue,
  goalProgress,
  inicioOpenCount,
  derivedFollowupMessages,
  listSubtitle,
  messageIdeas,
  monthCommissionUsd,
  nextStepText,
  offerRules,
  paraLlegarLines,
  rankFollowups,
  rowCommissionUsd,
  sheetBlocks,
  shownOffer,
  startSteps,
  type InicioFollowupSource,
} from "./inicio-view";
import {
  MOBILE_TABS,
  MORE_LINKS,
  accountIdentity,
  avatarLetter,
  moreActive,
  navActive,
  showPracticeTabBar,
  phoneBarTabs,
  visibleTabs,
} from "./mobile-nav";

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

test("qué quedó never says «vencido» and prefers a dated follow-up over the generic line", () => {
  assert.equal(
    nextStepText(row("x", { acuerdo: "", proximaAccion: "Seguimiento · vencido", dueAt: "", proximo: "" })),
    "Retomar el contacto",
  );
  assert.equal(
    nextStepText(
      row("Jessica", {
        acuerdo: "",
        proximaAccion: "Seguimiento · atrasado",
        hilo: "SEGUIMIENTO",
        proximo: "2026-09-23",
      }),
      NOW,
    ),
    "Seguimiento pendiente desde el 23 sep",
  );
  assert.equal(
    nextStepText(
      row("Elber", {
        acuerdo: "El cliente evaluará la propuesta enviada y dará una respuesta o decisión.",
        hilo: "DECISION",
        proximo: "2026-09-23",
      }),
      NOW,
    ),
    "El cliente evaluará la propuesta enviada y dará una respuesta o decisión.",
  );
  assert.equal(nextStepText(row("x", { acuerdo: "llamarlo el lunes para cerrar" }), NOW), "Llamarlo el lunes para cerrar");
  assert.equal(nextStepText(row("x", { proximaAccion: "Enviar link de pago · vencido" }), NOW), "Enviar link de pago");
  assert.equal(
    nextStepText(
      row("x", { callAcuerdo: "Quedó en revisarlo con su contador", acuerdo: "enviar mensaje · vencido" }),
      NOW,
    ),
    "Quedó en revisarlo con su contador",
  );
  assert.equal(
    nextStepText(
      row("x", {
        acuerdo: "",
        proximaAccion: "Seguimiento · atrasado",
        hilo: "SEGUIMIENTO",
        proximo: "2026-09-23",
        callNote: "Quedó en que lo habla con su esposo antes de decidir.",
      }),
      NOW,
    ),
    "Quedó en que lo habla con su esposo antes de decidir.",
  );
  assert.equal(
    nextStepText(row("x", { acuerdo: "WhatsApp", callNote: "Quedó en mandarle la propuesta." }), NOW),
    "Quedó en mandarle la propuesta.",
  );
});

test("a message draft uses what was left, not a clock or a channel", () => {
  const lines = derivedFollowupMessages({
    name: "Ana Ruiz",
    offer: "",
    step: "Quedó en revisar la propuesta",
    when: "Hoy 3:00 pm",
  });
  assert.match(lines[0] || "", /propuesta/);
  assert.equal(lines.some((line) => /3:00|whatsapp/i.test(line)), false);
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
  const ana = list.rows.find((item) => item.name === "Ana Ruiz");
  assert.equal(ana?.commissionUsd, 900);
  assert.equal(ana?.commissionLabel, "comisión si cierra");
  assert.equal(list.rows.find((item) => item.name === "Beto Paz")?.commissionUsd, 900);
  assert.equal(list.rows.find((item) => item.name === "Beto Paz")?.commissionLabel, "comisión");
  const unknown = buildInicioList({
    followups: [row("Nada", { oferta: "Sin Regla", enJuego: 0, proximo: "2026-10-04" })],
    rules: RULES,
    now: NOW,
  });
  assert.equal(unknown.rows[0]?.commissionUsd, null);
  assert.equal(unknown.rows[0]?.commissionLabel, "");
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
  assert.equal(noGoal.closes, "");
  const monthOnly = paraLlegarLines({
    ...base,
    metaUsd: null,
    projection: null,
    lastClose: { days: 4, callsSince: 7 },
    outcomes: { won: 2, lost: null },
  });
  assert.equal(monthOnly.headline, "");
  assert.equal(monthOnly.closes, "2 cierres este mes");
  assert.equal(monthOnly.versus, "2 cerrados · perdidos sin datos");
  assert.equal(monthOnly.closeCalls, "7 llamadas desde entonces");
});

test("a missing offer is filled from the person's call, not from another catalog offer", () => {
  const list = buildInicioList({
    followups: [row("Elber", { oferta: "", proximo: "2026-10-04" })],
    rules: RULES,
    now: NOW,
    calls: [{ cliente: "Elber", oferta: "Círculo Millonario", fecha: "2026-10-01" }],
    leadOffers: [{ name: "Otra", offer: "Fertilidad Consciente" }],
  });
  assert.equal(list.rows[0]?.offer, "Círculo Millonario");
  const blank = buildInicioList({
    followups: [row("Nadie", { oferta: "", proximo: "2026-10-04" })],
    rules: RULES,
    now: NOW,
  });
  assert.equal(blank.rows[0]?.offer, "");
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
  assert.deepEqual(phoneBarTabs(null).map((tab) => tab.label), ["Inicio", "Llamadas", "Práctica", "CRM"]);
  assert.deepEqual(phoneBarTabs(false).map((tab) => tab.label), ["Inicio", "Llamadas", "Práctica"]);
  assert.deepEqual(phoneBarTabs(true).map((tab) => tab.label), ["Inicio", "Llamadas", "Práctica", "CRM"]);
  assert.equal(navActive("/", "/"), true);
  assert.equal(navActive("/crm", "/"), false);
  assert.equal(navActive("/coach/abc", "/coach"), true);
  assert.equal(moreActive("/ofertas"), true);
  assert.equal(moreActive("/crm"), false);

  const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /useState<boolean \| null>\(null\)/);
  assert.match(shell, /phoneBarTabs\(showCrm\)/);
  assert.match(shell, /fixed inset-x-0 bottom-0 z-40[^"]*pb-\[env\(safe-area-inset-bottom\)\][^"]*md:hidden/);
  assert.match(shell, /pb-\[calc\(6rem\+env\(safe-area-inset-bottom\)\)\] md:pb-6/);
  assert.match(shell, /aria-\[current=page\]:font-semibold/);
  // Desktop keeps the pill menu; the phone no longer scrolls a pill row sideways.
  assert.match(shell, /hidden md:flex items-center gap-1 text-sm/);
  assert.doesNotMatch(shell, /overflow-x-auto/);
  const ask = readFileSync(new URL("../components/crm-ask.tsx", import.meta.url), "utf8");
  assert.match(ask, /bottom-\[calc\(4rem\+env\(safe-area-inset-bottom\)\)\] md:bottom-0/);
  const practice = readFileSync(new URL("../app/(practice)/layout.tsx", import.meta.url), "utf8");
  assert.match(practice, /PracticeShell/);
  assert.doesNotMatch(practice, /SidebarProvider/);
  const page = readFileSync(new URL("../app/(practice)/practicar/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /AuthMenu/);
  assert.doesNotMatch(page, /PRACTICE_NAV/);
  const practiceShell = readFileSync(new URL("../components/practice-tab-bar.tsx", import.meta.url), "utf8");
  assert.match(practiceShell, /MobileTabBar/);
  assert.match(practiceShell, /AppShell/);
  assert.match(practiceShell, /useState<boolean \| null>\(null\)/);
});

test("the same rank and the same open count for Inicio and the CRM", () => {
  const tied: InicioFollowupSource[] = [
    row("Zoe", { id: "b", proximo: "2026-10-03", enJuego: 1000 }),
    row("Ana", { id: "a", proximo: "2026-10-03", enJuego: 1000 }),
    row("Ana", { id: "dup", proximo: "2026-09-01", enJuego: 1 }),
    row("   ", { id: "blank", proximo: "2026-10-01", enJuego: 9000 }),
    row("Sin fecha", { id: "nodate", proximo: "", dueAt: "", enJuego: 9000 }),
    row("Luego", { id: "later", proximo: "2026-10-20", enJuego: 5000 }),
  ];
  const names = rankFollowups(tied, NOW).map((item) => item.cliente);
  assert.deepEqual(names, ["Ana", "Zoe", "Luego"]);
  const desk = prioritizeDesk(
    rankFollowups(tied, NOW).map((item) => ({
      id: item.id,
      name: item.cliente,
      step: "",
      date: String(item.proximo).slice(0, 10),
      estado: "HOY" as const,
      amount: item.enJuego || 0,
      lateDays: 0,
      reason: "",
      kind: "llamada" as const,
      daysAhead: String(item.proximo) > "2026-10-04" ? 1 : 0,
    })),
  ).map((line) => line.name);
  assert.deepEqual(desk, names);
  assert.ok(
    compareFollowupRank(
      { id: "b", name: "Ana", amount: 1, lateDays: 0, step: "" },
      { id: "a", name: "Ana", amount: 1, lateDays: 0, step: "" },
    ) > 0,
  );
  const open = inicioOpenCount(tied);
  const list = buildInicioList({ followups: tied, rules: RULES, now: NOW });
  assert.equal(open, 3);
  assert.equal(list.total, open);
  assert.equal(
    openFollowupCountOf(tied.map((item) => ({ cliente: item.cliente, proximo: item.proximo, dueAt: item.dueAt }))),
    open,
  );
  const filings = pickOpenByName([
    { name: "Ana", due: "2026-10-03", closed: false },
    { name: "Cerrado", due: "2026-10-01", closed: true },
    { name: "Cerrado", due: "2026-09-01", closed: false },
    { name: "Luego", due: "2026-10-20", closed: false },
  ]);
  assert.deepEqual(
    filings.map((item) => item.name),
    ["Ana", "Luego"],
  );
});

test("the 3-step card only when there is no goal and no lista de hoy", () => {
  assert.equal(startSteps({ hasGoal: false, openFollowups: 0, offersLoaded: false, hasCalls: false }).show, true);
  assert.equal(startSteps({ hasGoal: false, openFollowups: 0, offersLoaded: true, hasCalls: true }).show, true);
  const onlyGoal = startSteps({ hasGoal: false, openFollowups: 4, offersLoaded: true, hasCalls: true });
  assert.equal(onlyGoal.show, false);
  assert.equal(startSteps({ hasGoal: true, openFollowups: 0, offersLoaded: true, hasCalls: true }).show, false);
  assert.equal(startSteps({ hasGoal: false, openFollowups: 2, offersLoaded: false, hasCalls: true }).show, false);
  const fresh = startSteps({ hasGoal: false, openFollowups: 0, offersLoaded: false, hasCalls: false });
  assert.equal(fresh.goalDone, false);
  assert.equal(fresh.offerDone, false);
  assert.equal(fresh.callDone, false);
  assert.equal(listSubtitle(false), "Primero lo más urgente y con más dinero en juego");
  assert.equal(listSubtitle(true), "Primero lo que más te acerca a la meta");
});

test("suggested messages come from the offer scripts, otherwise from the agreement", () => {
  const scripts = [
    { guion: "Hola [Nombre], ¿seguimos con [PROGRAMA]?", canal: "WHATSAPP", type: "RETOMAR" },
    { guion: "Hola [Nombre], te escribo por [PROGRAMA]. ¿Qué te falta?", canal: "WHATSAPP", type: "DECISION" },
    { guion: "Hola [Nombre], el pago de USD [MONTO] de [PROGRAMA].", canal: "WHATSAPP", type: "PAGO PENDIENTE" },
  ];
  const fromOffer = messageIdeas({
    name: "Elber",
    offer: "Círculo Millonario",
    scripts,
    tipo: "DECISION",
    step: "El cliente evaluará la propuesta",
  });
  assert.equal(fromOffer.length >= 2 && fromOffer.length <= 3, true);
  assert.match(fromOffer[0] || "", /Elber/);
  assert.match(fromOffer[0] || "", /Círculo Millonario/);
  assert.equal(fromOffer.some((line) => /USD\s*[.,]/.test(line) || /\[[^\]]+\]/.test(line)), false);
  const derived = messageIdeas({
    name: "Jessica Pajuelo",
    offer: "Círculo Millonario",
    scripts: [],
    step: "Seguimiento pendiente desde el 23 sep",
    when: "Hace 12 días sin respuesta",
  });
  assert.equal(derived.length >= 2 && derived.length <= 3, true);
  assert.match(derived[0] || "", /Jessica/);
  assert.match(derived.join(" "), /Círculo Millonario/);
  assert.equal(derived.some((line) => /pendiente desde el 23 sep/.test(line)), false);
  const quoted = derivedFollowupMessages({
    name: "Diego",
    offer: "",
    step: "Quedó en revisarlo con su contador",
    when: "Hoy 3:00 pm",
  });
  assert.match(quoted[0] || "", /contador/);
  assert.equal(quoted.some((line) => /USD|300/.test(line)), false);
  const third = derivedFollowupMessages({
    name: "Elber",
    offer: "",
    step: "El cliente evaluará la propuesta enviada y dará una respuesta o decisión.",
  });
  assert.equal(third.some((line) => /el cliente/i.test(line)), false);
  assert.match(third[0] || "", /Elber/);
  assert.match(third.join(" "), /propuesta/i);
  assert.match(third[1] || "", /¿Ya revisaste la propuesta/);
  assert.equal(
    closerFacingNote("El cliente evaluará la propuesta enviada y dará una respuesta o decisión."),
    "Quedó en revisar la propuesta y dar una respuesta.",
  );
  assert.equal(closerFacingNote("Quedó en revisarlo con su contador"), "Quedó en revisarlo con su contador");
  const noted = buildInicioList({
    followups: [
      row("Elber", {
        acuerdo: "El cliente evaluará la propuesta enviada y dará una respuesta o decisión.",
        proximo: "2026-09-23",
        dueAt: "2026-09-23T18:00:00.000Z",
      }),
    ],
    rules: [],
    now: NOW,
  });
  assert.equal(noted.rows[0]?.step, "Quedó en revisar la propuesta y dar una respuesta.");
  assert.equal(noted.rows[0]?.agreement, "Quedó en revisar la propuesta y dar una respuesta.");
  assert.equal(noted.rows[0]?.whenDate, "Pendiente desde el 23 sep");
  assert.match(noted.rows[0]?.messages.join(" ") || "", /¿Ya revisaste la propuesta/);
  const ideas = messageIdeas({
    name: "Elber",
    offer: "Círculo Millonario",
    suggested: "El cliente evaluará la propuesta enviada y dará una respuesta o decisión.",
    scripts: [],
    step: "El cliente evaluará la propuesta enviada y dará una respuesta o decisión.",
  });
  assert.equal(ideas.some((line) => /el cliente/i.test(line)), false);
  assert.match(ideas[0] || "", /Elber/);
  assert.equal(secondPersonCue("Quedó en revisarlo con su contador"), "Quedó en revisarlo con su contador");
  const withMaterial = buildInicioList({
    followups: [row("Ana Ruiz", { proximo: "2026-10-04", enJuego: 0 })],
    rules: offerRules([
      {
        productName: "Círculo Millonario",
        commercial: {
          listPrice: 9000,
          currency: "USD",
          commission: commission(0.1),
          scripts: [{ type: "RETOMAR", canal: "WHATSAPP", guion: "Hola [Nombre]", asset: "https://ejemplo.test/caso" }],
        },
      },
    ]),
    successes: [{ name: "Luis Gómez", offer: "Círculo Millonario" }],
    now: NOW,
  });
  assert.deepEqual(withMaterial.rows[0]?.material, ["Luis Gómez ya cerró Círculo Millonario", "https://ejemplo.test/caso"]);
  const hidden = buildInicioList({ followups: [row("Ana Ruiz", { proximo: "2026-10-04" })], rules: RULES, now: NOW });
  assert.deepEqual(hidden.rows[0]?.material, []);
  assert.ok((hidden.rows[0]?.messages.length || 0) >= 2);
});

test("Inicio and «¿A quién llamo hoy?» share the rank, including ties", () => {
  const tied: InicioFollowupSource[] = [
    row("Jessica Pajuelo", { id: "j", proximo: "2026-09-23", enJuego: 0, hilo: "SEGUIMIENTO", dueAt: "2026-09-23T13:00:00.000Z" }),
    row("Elber", { id: "e", proximo: "2026-09-23", enJuego: 0, hilo: "DECISION", dueAt: "2026-09-23T18:00:00.000Z" }),
    row("Néstor Mollehuara", { id: "n", proximo: "2026-09-25", enJuego: 0, hilo: "SEGUIMIENTO" }),
    row("Sebastián Ramirez", { id: "s", proximo: "2026-09-25", enJuego: 0, hilo: "SEGUIMIENTO" }),
    row("Maria Patricia", { id: "m", proximo: "2026-09-25", enJuego: 0, hilo: "SEGUIMIENTO" }),
  ];
  const inicio = rankFollowups(tied, NOW).map((item) => item.cliente);
  const ask = answerCrmFollowups(
    tied.map((item) => ({
      id: item.id,
      cliente: item.cliente,
      dueAt: item.dueAt,
      proximo: item.proximo,
      hilo: item.hilo,
      enJuego: item.enJuego,
    })),
    "¿A quién llamo hoy?",
    { now: NOW },
  );
  const asked = [...ask.matchAll(/^• ([^·\n]+)/gm)].map((match) => match[1].trim());
  assert.deepEqual(asked, inicio);
  assert.deepEqual(inicio, ["Elber", "Jessica Pajuelo", "Maria Patricia", "Néstor Mollehuara", "Sebastián Ramirez"]);
  assert.ok(compareFollowupRank(followupRankInput(tied[1], NOW), followupRankInput(tied[0], NOW)) < 0);
});

test("the person sheet hides a block that has no real data", () => {
  const empty = sheetBlocks({
    agreement: "  ",
    nextStep: "Retomar el contacto",
    when: "",
    messages: ["", "  "],
    material: [],
    phone: " ",
  });
  assert.equal(empty.agreement, "");
  assert.equal(empty.when, "");
  assert.deepEqual(empty.messages, []);
  assert.deepEqual(empty.material, []);
  assert.equal(empty.phone, "");
  const same = sheetBlocks({
    agreement: "Quedó en revisarlo con su contador",
    nextStep: "Quedó en revisarlo con su contador",
    when: "Hoy 3:00 pm",
    messages: ["Hola Diego"],
    material: [],
    phone: "+57 300",
  });
  assert.equal(same.nextStep, "");
  assert.equal(same.agreement, "Quedó en revisarlo con su contador");
  const late = followupWhenParts({ proximo: "2026-09-23", dueAt: "2026-09-23T18:00:00.000Z" }, NOW);
  assert.equal(late.date, "Pendiente desde el 23 sep");
  assert.match(late.age, /^Hace \d+ días sin respuesta$/);
  const lateClock = followupWhenParts({ proximo: "2026-09-23 15:00" }, NOW);
  assert.equal(lateClock.date, "Pendiente desde el 23 sep, 3:00 pm");
  const both = sheetBlocks({
    agreement: "El cliente evaluará la propuesta enviada y dará una respuesta o decisión.",
    nextStep: "El cliente evaluará la propuesta enviada y dará una respuesta o decisión.",
    when: late.date,
    age: late.age,
    messages: [],
    material: [],
    phone: "",
  });
  assert.equal(both.agreement, "Quedó en revisar la propuesta y dar una respuesta.");
  assert.equal(both.nextStep, "");
  assert.equal(both.when, "Pendiente desde el 23 sep");
  assert.match(both.age || "", /sin respuesta/);
  const todayOnly = followupWhenParts({ proximo: "2026-10-04 15:00" }, NOW);
  assert.equal(todayOnly.date, "Hoy 3:00 pm");
  assert.equal(todayOnly.age, "");
  assert.equal(followupWhenParts({ proximo: "", dueAt: "" }, NOW).date, "");
  assert.deepEqual(same.messages, ["Hola Diego"]);
  assert.deepEqual(same.material, []);
  assert.equal(shownOffer("—"), "");
  assert.equal(shownOffer("sin oferta"), "");
  assert.equal(shownOffer("Círculo Millonario"), "Círculo Millonario");
  const cut = cutAtWord("Quedó en revisarlo con su contador y el desglose de pagos para que lo vean juntos..", 40);
  assert.equal(cut.includes(".."), false);
  assert.equal(cut.endsWith("…"), false);
  assert.ok(cut.length <= 40);
});

test("the header letter comes from the display name, else the email", () => {
  assert.equal(avatarLetter("A", "sofia@closer.com"), "S");
  assert.equal(avatarLetter("Sofía León", "a@closer.com"), "S");
  assert.equal(accountIdentity("Sofía León", "a@closer.com"), "Sofía León");
  assert.equal(accountIdentity("A", "ana@closer.com"), "ana@closer.com");
  assert.equal(showPracticeTabBar({ phase: "idle", shouldConnect: false, isConnecting: false }), true);
  assert.equal(showPracticeTabBar({ phase: "ready", shouldConnect: true, isConnecting: false }), false);
  assert.equal(showPracticeTabBar({ phase: "audio", shouldConnect: false, isConnecting: false }), false);
  assert.equal(showPracticeTabBar({ phase: "error", shouldConnect: false, isConnecting: false }), true);
});
