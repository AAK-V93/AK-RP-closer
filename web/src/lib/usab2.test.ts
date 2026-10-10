import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { buildCrmBoard, CRM_HOY_CAP, type CrmBoardFollowup } from "./crm-board";
import { STAGE_DISABLED_NOTE } from "./followup-stage";
import { emptyExtractor } from "./extractor";
import {
  hasSalesSignal,
  pickRecording,
  readRecordingOnce,
  recordingFicha,
  type RecordingRow,
} from "./recording-ficha";
import { addToCrmProposal, addToCrmResult } from "./recording-ficha-copy";
import { fichaDetailRows } from "./ficha-target";

const NOW = new Date("2026-10-09T15:00:00Z");
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/* ---------- P1. En seguimiento always lists its people ---------- */

function followup(i: number, partial: Partial<CrmBoardFollowup> = {}): CrmBoardFollowup {
  const late = i < 27; // 27 for today or late, like production
  const day = late ? `2026-09-${String(10 + (i % 18)).padStart(2, "0")}` : `2026-10-${String(12 + i - 27).padStart(2, "0")}`;
  return {
    id: `f${i}`,
    leadId: `L${i}`,
    cliente: `Persona ${String.fromCharCode(65 + (i % 26))}${i}`,
    dueAt: `${day}T15:00:00.000Z`,
    proximo: day,
    hilo: "SEGUIMIENTO",
    oferta: i % 3 === 0 ? "Fertilidad Consciente" : "Círculo Millonario",
    ...partial,
  };
}

test("En seguimiento (34) renders its 34 rows with no search, even when hoy has more than fits", () => {
  const followups = Array.from({ length: 34 }, (_, i) => followup(i));
  const board = buildCrmBoard({ calls: [], followups, now: NOW, period: "mes" });
  assert.equal(board.counts.seguimiento, 34);
  assert.ok(board.hoy.length > CRM_HOY_CAP, "hoy overflows like production (27)");
  assert.equal(board.rows.length, 34, "the tab list is not empty");
  assert.equal(board.empty, "");
  assert.match(board.footer, /^34 personas/);
});

test("offer and stage filters change the tab list (and its badge) without a search", () => {
  const followups = Array.from({ length: 34 }, (_, i) => followup(i));
  const fert = buildCrmBoard({ calls: [], followups, now: NOW, period: "mes", offer: "Fertilidad Consciente" });
  assert.equal(fert.rows.length, followups.filter((row) => row.oferta === "Fertilidad Consciente").length);
  assert.equal(fert.counts.seguimiento, fert.rows.length);
  assert.ok(fert.rows.every((row) => row.offer === "Fertilidad Consciente"));
  const stageCounts = Object.fromEntries(followups.map((row, i) => [row.leadId!, i < 5 ? 2 : 0]));
  const low = buildCrmBoard({ calls: [], followups, now: NOW, period: "mes", stageCounts, stageFilter: "1-2" });
  assert.equal(low.rows.length, 5);
  assert.equal(low.counts.seguimiento, 5);
  const both = buildCrmBoard({ calls: [], followups, now: NOW, period: "mes", stageCounts, stageFilter: "1-2", offer: "Fertilidad Consciente" });
  assert.deepEqual(both.rows.map((row) => row.name).sort(), ["Persona A0", "Persona D3"]);
  const searched = buildCrmBoard({ calls: [], followups, now: NOW, period: "mes", stageCounts, stageFilter: "1-2", query: "Persona D3" });
  assert.deepEqual(searched.rows.map((row) => row.name), ["Persona D3"]);
});

test("the tab list is never gated behind «Ver más»; the stage filter shows disabled in Perdidos/Cerrados with a reason", () => {
  const source = read("../components/crm-board.tsx");
  assert.doesNotMatch(source, /showLater/);
  assert.match(source, /data-crm-tab-list/);
  assert.match(source, /bucket !== "seguimiento" && !query\.trim\(\)[\s\S]{0,400}disabled/);
  assert.match(source, /STAGE_DISABLED_NOTE/);
  assert.match(STAGE_DISABLED_NOTE, /Cerrados y perdidos no tienen etapa/);
});

/* ---------- P2. Fichas for old calls ---------- */

const ADRIANA: RecordingRow = {
  id: "cmtukq0wu000rl204h2njwl3s",
  kind: "fathom",
  title: "Adriana Muñeton",
  recordedAt: "2026-09-03T20:00:00Z",
  transcript:
    "Closer: Hola Adriana. ... Adriana: Me encanta, pero la inversión de 2.000 dólares la tengo que consultar con mi esposo. Closer: Perfecto, te llamo el viernes. ".repeat(3),
};

test("only calls with money or a next step are read", () => {
  assert.equal(hasSalesSignal(ADRIANA.transcript), true);
  assert.equal(hasSalesSignal("Hola equipo, repasemos el tablero del sprint y las tareas internas."), false);
  assert.equal(hasSalesSignal(""), false);
});

test("the recording is found by id or by the name on its title (closest day)", () => {
  const rows: RecordingRow[] = [
    ADRIANA,
    { ...ADRIANA, id: "older", recordedAt: "2026-07-01T20:00:00Z" },
    { id: "other", kind: "fathom", title: "Impromptu Google Meet Meeting", recordedAt: "2026-09-03T20:00:00Z", transcript: "" },
  ];
  assert.equal(pickRecording(rows, { callId: "other" })?.id, "other");
  assert.equal(pickRecording(rows, { name: "Adriana Muñeton", day: "2026-09-03" })?.id, ADRIANA.id);
  assert.equal(pickRecording(rows, { name: "adriana muñeton", day: "2026-07-02" })?.id, "older");
  assert.equal(pickRecording(rows, { name: "Nadie Aquí" }), null);
});

test("a read recording fills the ficha with what came out of the call; nothing invented", () => {
  const parsed = emptyExtractor();
  parsed.estado_agenda = "SHOW";
  parsed.venta_total = 2000;
  parsed.razon_no_cierre = "Necesita consultarlo con alguien";
  parsed.acuerdo_seguimiento = "Llamarla el viernes después de que hable con su esposo.";
  parsed.notas_crm = "Le gustó el programa; decide con su esposo.";
  const { facts, recording } = recordingFicha({ name: "Adriana Muñeton", row: ADRIANA, parsed, state: "read", filed: false, now: NOW });
  assert.equal(recording.read, true);
  assert.equal(recording.canAdd, true);
  assert.equal(recording.day, "2026-09-03");
  assert.match(recording.note, /sale de la grabación del 3 sep; no se guardó nada/);
  const rows = Object.fromEntries(fichaDetailRows(facts).map((row) => [row.label, row.values]));
  assert.match(rows["Objeciones"][0], /consultar/i);
  assert.match(rows["Presupuesto y forma de pago"][0], /2[.,]?000/);
  assert.ok(rows["Acuerdos"].some((value) => /esposo/.test(value)));
  // Not in the recording → stays empty (the ficha says «No quedó claro en la llamada»).
  assert.deepEqual(rows["Quién decide"], []);
});

test("no transcript / no signal / reading failed: honest note, no facts, «Agregar al CRM» only with a transcript", () => {
  const empty = recordingFicha({ name: "Adriana Muñeton", row: { ...ADRIANA, transcript: "" }, parsed: null, state: "no-transcript", filed: false, now: NOW });
  assert.match(empty.recording.note, /no tiene transcripción/);
  assert.equal(empty.recording.canAdd, false);
  assert.equal(empty.recording.read, false);
  assert.ok(fichaDetailRows(empty.facts).every((row) => row.values.length === 0));
  const quiet = recordingFicha({ name: "Adriana Muñeton", row: ADRIANA, parsed: null, state: "no-signal", filed: false, now: NOW });
  assert.match(quiet.recording.note, /no se habló de precio, pago ni de un siguiente paso/);
  const failed = recordingFicha({ name: "Adriana Muñeton", row: ADRIANA, parsed: null, state: "failed", filed: true, now: NOW });
  assert.match(failed.recording.note, /No pude leer la grabación/);
  assert.equal(failed.recording.canAdd, false, "already filed");
});

test("reading is cached for a while and a failure is retried", async () => {
  let calls = 0;
  const ok = async () => {
    calls += 1;
    return emptyExtractor();
  };
  await readRecordingOnce("t:ok", ok, 1_000);
  await readRecordingOnce("t:ok", ok, 2_000);
  assert.equal(calls, 1);
  await readRecordingOnce("t:ok", ok, 1_000 + 31 * 60_000);
  assert.equal(calls, 2);
  let tries = 0;
  const fail = async () => {
    tries += 1;
    throw new Error("timeout");
  };
  assert.equal(await readRecordingOnce("t:fail", fail, 1_000), null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await readRecordingOnce("t:fail", fail, 2_000);
  assert.equal(tries, 2);
});

test("«Agregar al CRM» is a proposal saved only with «Guardar»; opening a ficha never writes", () => {
  assert.match(addToCrmProposal("Adriana Muñeton"), /No se guarda nada hasta que toques «Guardar»/);
  assert.equal(addToCrmResult("Adriana", { filingStatus: "confirmed" }), "Listo: Adriana está en tu CRM.");
  assert.match(addToCrmResult("Adriana", { filingStatus: "pending", question: "¿Qué oferta era?" }), /Por confirmar: ¿Qué oferta era\?/);
  const load = read("./recording-ficha-load.ts");
  assert.doesNotMatch(load, /\.(create|update|upsert|delete)(Many)?\(/);
  const ficha = read("../app/api/crm/ficha/route.ts");
  assert.doesNotMatch(ficha, /classifyAndFileCall|export async function POST/);
  const add = read("../app/api/crm/ficha/agregar/route.ts");
  assert.match(add, /export async function POST/);
  assert.doesNotMatch(add, /export async function GET/);
  const ui = read("../components/person-ficha.tsx");
  assert.match(ui, /AddToCrmCard[\s\S]*Guardar[\s\S]*No/);
});
