// PR 6 (Confirmar): pure rules, the screen's copy against mockup 04 and the
// guards of the write (single statements, undo, WRITE_EFFECTS). No DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NO_DATE_LABEL, OUTCOME_LABEL, PENDING_PAYMENT_LABEL, briefDay, briefTime, dealDefaults, savedText } from "@/lib/confirm/choice";
import { otherCurrencyNotes } from "@/lib/format/currency-note";
import { HIDDEN_LINKS as HL } from "@/lib/hidden-links";
import { undoEventId } from "@/lib/write/events";
import { changeTask } from "@/lib/write/confirm";
import { HIDDEN_LINKS } from "@/lib/hidden-links";
import { confirmProgress } from "@/lib/metrics";
import { WRITE_EFFECTS, tagsForWrite } from "@/lib/read/tags";

const SRC = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("the confirm screen exists, so its hidden link is gone; Hoy links straight to it", () => {
  assert.equal("hoy.confirmar" in HIDDEN_LINKS, false);
  const hoy = read("app/(v2)/page.tsx");
  assert.doesNotMatch(hoy, /showLink\("hoy\.confirmar"\)/);
  assert.match(hoy, /href="\/confirmar"/);
  assert.match(hoy, /llamadas por confirmar/);
  assert.match(hoy, /te toma un toque cada una/);
  // the › to the ficha waits for its screen (PR 7)
  assert.ok("confirmar.ficha" in HIDDEN_LINKS);
});

test("mockup 04 copy: title, subtitle, «Llevas X de N», the 4 options, «Guardado» + «Deshacer», «Ignoradas (N)»", () => {
  const page = read("app/(v2)/confirmar/page.tsx");
  for (const s of [
    "Llamadas por confirmar",
    "Yo escuché cada llamada. Toca lo que pasó; el borde negro es lo que yo entendí.",
    "Llevas {progress.done} de {progress.total}",
    "Deshacer",
    "Ignoradas ({ignoredCount})",
    "No era interna",
    "¿Quién es?",
    "Toca › para ver el resumen completo en la ficha de la persona.",
  ]) assert.ok(page.includes(s), s);
  assert.deepEqual(Object.values(OUTCOME_LABEL), ["Cerró", "Sigue en seguimiento", "Perdido", "Reagendar"]);
  // the suggested option is the black border; without a suggestion none is marked
  assert.match(page, /c\.suggestedOutcome === o \? "opt sug" : "opt"/);
  // «Cerró» asks amount and payment mode, with «No sé todavía»
  assert.match(page, /No sé todavía/);
  assert.equal(PENDING_PAYMENT_LABEL, "Pendiente de pago");
  // zero jargon in what the closer reads (JSX text and the saved texts)
  const visible = [...page.matchAll(/>([^<>{}]+)</g)].map((m) => m[1].trim()).filter(Boolean).join(" | ");
  assert.doesNotMatch(visible + Object.values(OUTCOME_LABEL).join(" "), /\b(lead|deal|crm|pipeline|status|webhook|brief)\b/i);
});

test("saved text, brief day and «Cerró» defaults never invent data", () => {
  assert.equal(savedText("SEGUIMIENTO", true), "Guardado: sigue en seguimiento · pendiente de pago");
  assert.equal(savedText("SEGUIMIENTO", false), "Guardado: sigue en seguimiento");
  assert.equal(savedText("CERRO", false), "Guardado: venta cerrada");
  assert.equal(briefDay("2026-10-09T15:00"), "2026-10-09");
  assert.equal(briefDay("el viernes"), null);
  assert.equal(briefDay("2026-02-30"), null);
  assert.deepEqual(dealDefaults(null), { amountTotal: null, cashCollected: null, paymentMode: null, currency: null });
  assert.deepEqual(dealDefaults({ venta_total: 2000, cash_collected: 300, modo_pago: "en 3 cuotas", moneda: "USD" }), { amountTotal: 2000, cashCollected: 300, paymentMode: "CUOTAS", currency: "USD" });
  assert.equal(dealDefaults({ venta_total: null, cash_collected: null, modo_pago: "de contado", moneda: null }).paymentMode, "CONTADO");
});

test("«Llevas X de N» = saved in this visit of (saved + still waiting)", () => {
  assert.deepEqual(confirmProgress(1, 4), { done: 1, total: 5, ratio: 0.2 });
  assert.deepEqual(confirmProgress(0, 0), { done: 0, total: 0, ratio: 0 });
});

test("WRITE_EFFECTS: confirm, apply, undo and «No era interna» revalidate the banner, Hoy/Metas numbers, lists and the person", () => {
  const all = (e: ReturnType<typeof WRITE_EFFECTS.confirmCall>) => tagsForWrite("u", e).sort();
  const expected = ["u:u:lead:L", "u:u:leads", "u:u:pending", "u:u:stats"];
  assert.deepEqual(all(WRITE_EFFECTS.confirmCall("L")), expected);
  assert.deepEqual(all(WRITE_EFFECTS.applyProposedChange("L")), expected);
  assert.deepEqual(all(WRITE_EFFECTS.undoProposedChange("L")), expected);
  assert.deepEqual(all(WRITE_EFFECTS.recoverIgnoredCall()), ["u:u:pending", "u:u:practice", "u:u:stats"]);
  const write = stripComments(read("lib/write/confirm.ts"));
  for (const fn of ["confirmCall", "applyProposedChange", "undoProposedChange"]) {
    assert.match(write, new RegExp(`invalidate\\(userId, WRITE_EFFECTS\\.${fn}\\(`), fn);
  }
  // getPending is tagged with what confirming changes (names come from leads, offers)
  assert.match(read("lib/read/cached.ts"), /cachedRead\("pending", \[userId\], \{ tags: \[tags\.pending\(userId\), tags\.leads\(userId\), tags\.offers\(userId\)\]/);
});

test("guard: confirm/undo use single raw statements with ownership, never transactions or bulk/nested writes", () => {
  const write = stripComments(read("lib/write/confirm.ts"));
  assert.doesNotMatch(write, /\$transaction|updateMany|deleteMany|createMany|\.create\(|\.update\(|\.upsert\(|\.delete\(/);
  for (const stmt of write.matchAll(/\$executeRaw`([\s\S]*?)`/g)) {
    assert.match(stmt[1], /"userId" = \$\{userId\}|pc\."userId" = \$\{userId\}|x\."userId" = \$\{userId\}|t\."userId" = \$\{userId\}|l\."userId" = \$\{userId\}|\$\{userId\}, /, stmt[1].slice(0, 80));
  }
  // idempotency: a unique key per card version, a PENDING→APPLIED claim, rows tagged with the change
  assert.match(write, /`confirm:\$\{call\.id\}:\$\{choice\.version\}`/);
  assert.match(write, /"status" = 'APPLIED'[\s\S]*?"status" = 'PENDING'/);
  assert.match(write, /ON CONFLICT \("userId", "proposedChangeId"\) DO NOTHING/);
  assert.match(write, /ON CONFLICT \("leadId"\) WHERE "status" = 'OPEN' DO NOTHING/);
  // numbers are recounted (never ±1)
  assert.doesNotMatch(write, /Count" [+-] 1|Count" = "\w+" [+-]/);
});

test("«No era interna» reuses the stored brief: no model call", () => {
  const ingest = stripComments(read("lib/write/ingest.ts"));
  const start = ingest.indexOf("export async function recoverIgnoredCall");
  const body = ingest.slice(start, ingest.indexOf("\nasync function ", start));
  assert.ok(start > 0);
  assert.doesNotMatch(body, /runCallBrief|model|generateGemini/);
  assert.match(body, /parseBrief\(JSON\.stringify\(call\.brief\)\)/);
  assert.match(body, /invalidate\(userId, WRITE_EFFECTS\.recoverIgnoredCall\(/);
});

test("the last close and «llamadas desde el último cierre» come from the last ACTIVE Deal", () => {
  const recount = read("lib/write/recount.ts");
  assert.match(recount, /FROM "Deal" d JOIN "Lead" l ON l\.id = d\."leadId"\s+WHERE d\."userId" = \$\{userId\} AND d\.status = 'ACTIVO'\s+ORDER BY d\."closedAt" DESC/);
  assert.match(recount, /u\.currency = d\.currency/);
});


test("history is append-only: no DELETE or content UPDATE of LeadEvent anywhere; «Deshacer» compensates with UNDO events", () => {
  const files = ["lib/write/confirm.ts", "lib/write/events.ts", "lib/write/ingest.ts", "lib/write/recount.ts"];
  for (const f of files) {
    const code = stripComments(read(f));
    assert.doesNotMatch(code, /DELETE FROM "LeadEvent"/, f);
    for (const m of code.matchAll(/UPDATE "LeadEvent"[^`]*?SET([^`]*?)(FROM|WHERE)/g)) {
      const cols = [...m[1].matchAll(/"(\w+)"\s*=/g)].map((c) => c[1]);
      assert.deepEqual(cols, ["undoneAt", "undoneByEventId"], `${f}: only the undo mark changes`);
    }
  }
  assert.match(read("lib/write/confirm.ts"), /compensateEvents\(db, userId, \{ leadId: p\.leadId, proposedChangeId: changeId \}/);
  assert.equal(undoEventId("abc"), "undo_abc");
});

test("every count and read of attempts skips undone events (attemptsSinceLastCall, month, week, ficha)", () => {
  const recount = stripComments(read("lib/write/recount.ts"));
  const attemptSql = [...recount.matchAll(/e\.type = 'ATTEMPT'[^\n]*/g)].map((m) => m[0]);
  assert.ok(attemptSql.length >= 4);
  for (const line of attemptSql) assert.match(line, /e\."undoneAt" IS NULL/, line);
  for (const f of ["lib/read/goals.ts", "lib/read/ficha.ts"]) {
    const code = stripComments(read(f));
    const reads = [...code.matchAll(/type: "ATTEMPT"[^}]*/g)].map((m) => m[0]);
    assert.ok(reads.length >= 1, f);
    for (const r of reads) assert.match(r, /undoneAt: null/, `${f}: ${r}`);
  }
});

test("another currency is never summed nor dropped silently: «+ N ventas en <moneda> no incluidas»", () => {
  assert.deepEqual(otherCurrencyNotes([{ currency: "EUR", count: 1 }, { currency: "USD", count: 4 }, { currency: "MXN", count: 3 }], "USD"), [
    "+ 1 venta en EUR no incluida",
    "+ 3 ventas en MXN no incluidas",
  ]);
  assert.deepEqual(otherCurrencyNotes([{ currency: "USD", count: 2 }], "USD"), []);
  assert.match(read("app/(v2)/page.tsx"), /otherCurrencyNotes\(header\.dealCurrencies/);
  assert.match(read("app/(v2)/metas/page.tsx"), /otherCurrencyNotes\(data\.otherCurrencySales/);
});

test("«Reagendar»: a day (and time if the brief gave one) → REUNION task; no date → nothing invented, «sin fecha»", () => {
  assert.equal(briefTime("2026-10-15T15:30"), "15:30");
  assert.equal(briefTime("2026-10-15"), null);
  assert.equal(briefTime("2026-10-15T25:00"), null);
  assert.equal(briefTime(null), null);
  assert.equal(changeTask({ outcome: "REAGENDAR", followDay: "2026-10-15", pendingPayment: false }), "REUNION");
  assert.equal(changeTask({ outcome: "REAGENDAR", followDay: null, pendingPayment: false }), null);
  assert.equal(changeTask({ outcome: "SEGUIMIENTO", followDay: "2026-10-15", pendingPayment: true }), "COBRAR");
  assert.equal(changeTask({ outcome: "SEGUIMIENTO", followDay: "2026-10-15", pendingPayment: false }), null);
  assert.equal(savedText("REAGENDAR", false, true), "Guardado: reagendada · sin fecha");
  assert.equal(NO_DATE_LABEL, "Reagendar · sin fecha");
  // «Poner fecha» on the ficha / Personas arrives with PR 7 (with the ficha itself)
  assert.ok("confirmar.ficha" in HL);
});

test("WRITE_EFFECTS: an attempt and its «Deshacer» touch Hoy, the lists, the person and the numbers", () => {
  for (const e of [WRITE_EFFECTS.logAttempt("L1"), WRITE_EFFECTS.undoAttempt("L1")]) {
    assert.deepEqual(tagsForWrite("U", e).sort(), ["u:U:lead:L1", "u:U:leads", "u:U:stats"]);
  }
});
