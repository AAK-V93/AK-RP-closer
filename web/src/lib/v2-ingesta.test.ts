// PR 5 (ingesta), pure parts: Fathom fixtures from the public docs (verbatim
// webhook example, one with null summary, one in English), the brief with a
// mocked model (never Gemini), the Fathom client with a fake fetch (never
// Fathom), Arquitectura's Metas answers, hidden links and guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { verifyFathomWebhookSignature } from "@/lib/fathom";
import { HIDDEN_LINKS } from "@/lib/hidden-links";
import {
  BRIEF_GEMINI_SCHEMA, BRIEF_JSON_SCHEMA, buildBriefPrompt, outcomeFromBrief, parseBrief, runCallBrief, transcriptExcerpt,
} from "@/lib/ingest/brief";
import { FathomRateLimited, fathomClient, retryAfterSeconds, type FathomMeeting } from "@/lib/ingest/fathom-api";
import { durationFrom, fromFathomMeeting, fromUpload, subtitlesToText, timestampSeconds } from "@/lib/ingest/meeting";
import { proposalsFor } from "@/lib/ingest/proposals";
import { followupsHint, goalIdeas } from "@/lib/metrics";
import { TEST_WEBHOOK_SECRET, briefJson, mockModel, signedHeaders } from "@/lib/ingest/__fixtures__/helpers";

const SRC = path.resolve(__dirname, "..");
const FIX = path.join(__dirname, "ingest/__fixtures__");
const fixture = (name: string) => JSON.parse(readFileSync(path.join(FIX, name), "utf8")) as FathomMeeting;
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const appFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

// ---------- mapping (durationSec computed once, at ingest) ----------

test("docs webhook example (verbatim, no recording_id): falls back to its link, duration from recording times", () => {
  const m = fromFathomMeeting(fixture("fathom-webhook-docs.json"))!;
  assert.equal(m.sourceId, "url:https://fathom.video/share/xyz123");
  assert.equal(m.source, "FATHOM");
  assert.equal(m.title, "QBR 2025 Q1");
  assert.equal(m.durationSec, 59 * 60 + 43); // 16:01:12 → 17:00:55
  assert.equal(m.recordedAt.toISOString(), "2025-03-01T16:01:12.000Z");
  assert.match(m.summaryEn!, /^## Summary/);
  assert.equal(m.actionItemsEn, "[00:10:45] (Jane Doe) Email revised proposal to client");
  assert.equal(m.transcriptText, "[00:05:32] Jane Doe: Let's revisit the budget allocations.\n[00:05:40] John Smith: I agree, we need to adjust our projections.");
  // only external guests are lead candidates
  assert.deepEqual(m.invitees, [{ name: "John Smith", email: "john.smith@client.com" }]);
});

test("English meeting with recording_id; Spanish meeting; null summary → duration from the last transcript timestamp", () => {
  assert.equal(fromFathomMeeting(fixture("fathom-meeting-en.json"))!.sourceId, "123456789");
  const es = fromFathomMeeting(fixture("fathom-meeting-es.json"))!;
  assert.equal(es.sourceId, "987654321");
  assert.equal(es.durationSec, 52 * 60 + 30);
  assert.deepEqual(es.invitees, [{ name: "Laura Gómez", email: "laura.gomez@gmail.com" }]);
  const nul = fromFathomMeeting(fixture("fathom-meeting-null-summary.json"))!;
  assert.equal(nul.summaryEn, null);
  assert.equal(nul.actionItemsEn, null);
  assert.equal(nul.durationSec, 41 * 60 + 7);
  assert.equal(nul.title, "Pedro Ruiz - seguimiento");
  assert.equal(nul.recordedAt.toISOString(), "2026-10-06T15:00:00.000Z");
  // nothing to identify it → not ingested
  assert.equal(fromFathomMeeting({ title: "x" }), null);
});

test("timestamps and duration rules", () => {
  assert.equal(timestampSeconds("01:02:03"), 3723);
  assert.equal(timestampSeconds("02:03"), 123);
  assert.equal(timestampSeconds("00:00:05.500"), 5);
  assert.equal(timestampSeconds("abc"), null);
  const t = (s: string) => new Date(s);
  assert.equal(durationFrom(t("2026-01-01T10:00:00Z"), t("2026-01-01T10:30:00Z"), []), 1800);
  // end before start or absurd length → transcript fallback
  assert.equal(durationFrom(t("2026-01-01T10:30:00Z"), t("2026-01-01T10:00:00Z"), ["00:10:00", "00:20:00"]), 1200);
  assert.equal(durationFrom(null, null, []), null);
});

test("upload: .vtt cues become stamped lines; same text → same id (a second upload is a duplicate)", () => {
  const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n<v Ana>Hola, ¿me escuchas?\n\n2\n00:45:10.000 --> 00:45:15.000\n<v Kali>Te mando el link de pago hoy mismo y hablamos el lunes.\n";
  assert.equal(subtitlesToText(vtt), "[00:00:01] Ana: Hola, ¿me escuchas?\n[00:45:10] Kali: Te mando el link de pago hoy mismo y hablamos el lunes.");
  const a = fromUpload(vtt, { title: "Ana", recordedAt: new Date("2026-10-10T17:00:00Z") })!;
  const b = fromUpload(vtt, { title: "Otro título", recordedAt: null })!;
  assert.equal(a.source, "UPLOAD");
  assert.equal(a.sourceId, b.sourceId);
  assert.match(a.sourceId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(a.durationSec, 45 * 60 + 10);
  assert.equal(a.summaryEn, null);
  assert.equal(fromUpload("   ", { title: null, recordedAt: null }), null);
});

// ---------- brief ----------

function walkSchema(s: Record<string, unknown>, at: string, out: string[]) {
  if (Array.isArray(s.type)) out.push(`${at}: type array`);
  if (s.type === "null") out.push(`${at}: null type`);
  if (Array.isArray(s.enum) && s.enum.includes(null)) out.push(`${at}: null in enum`);
  const props = (s.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const r of (s.required as string[] | undefined) ?? []) if (!(r in props)) out.push(`${at}: required ${r} not in properties`);
  for (const [k, v] of Object.entries(props)) walkSchema(v, `${at}.${k}`, out);
  if (s.items) walkSchema(s.items as Record<string, unknown>, `${at}[]`, out);
  return out;
}

test("schema D2 → Gemini subset: no type arrays, no null in enums, nullable kept, required ⊆ properties", () => {
  assert.deepEqual(walkSchema(BRIEF_GEMINI_SCHEMA, "$", []), []);
  const props = BRIEF_GEMINI_SCHEMA.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(props.venta_total, { type: "number", nullable: true });
  assert.deepEqual(props.estado_lead.enum, ["cerrado", "pendiente_pago", "decidiendo", "reagendar", "perdido"]);
  assert.equal(props.estado_lead.nullable, true);
  // D2 field names are kept verbatim
  for (const k of ["cliente_real", "estado_agenda", "decisor", "promesas", "citas", "confianza", "faltantes"]) {
    assert.ok(k in (BRIEF_JSON_SCHEMA.properties as object), k);
  }
});

test("rule 2 of D1: an amount without its cita goes to null and to «faltantes»", () => {
  const withCita = parseBrief(briefJson())!;
  assert.equal(withCita.venta_total, 2000);
  const noCita = parseBrief(briefJson({ citas: [], cash_collected: 500 }))!;
  assert.equal(noCita.venta_total, null);
  assert.equal(noCita.cash_collected, null);
  assert.ok(noCita.faltantes.includes("venta_total") && noCita.faltantes.includes("cash_collected"));
  assert.equal(parseBrief("no es json"), null);
  assert.equal(parseBrief(JSON.stringify({ promesas: "x" })), null);
  const long = parseBrief(briefJson({ una_linea: "a".repeat(300) }))!;
  assert.ok(long.una_linea!.length <= 140);
  // fenced output is accepted too
  assert.equal(parseBrief("```json\n" + briefJson() + "\n```")!.cliente_real, "Laura Gómez");
});

test("estado_lead → suggested outcome; internal calls have none", () => {
  assert.equal(outcomeFromBrief({ estado_lead: "cerrado", estado_agenda: "CIERRE VENTA" }), "CERRO");
  assert.equal(outcomeFromBrief({ estado_lead: "perdido", estado_agenda: "SHOW" }), "PERDIDO");
  assert.equal(outcomeFromBrief({ estado_lead: "reagendar", estado_agenda: "REPROGRAMA" }), "REAGENDAR");
  assert.equal(outcomeFromBrief({ estado_lead: "pendiente_pago", estado_agenda: "ACUERDO SIN PAGO" }), "SEGUIMIENTO");
  assert.equal(outcomeFromBrief({ estado_lead: "decidiendo", estado_agenda: "SHOW" }), "SEGUIMIENTO");
  assert.equal(outcomeFromBrief({ estado_lead: null, estado_agenda: "SHOW" }), null);
  assert.equal(outcomeFromBrief({ estado_lead: "cerrado", estado_agenda: "INTERNA" }), null);
});

const brief = (m: FathomMeeting, offers = [{ name: "Mentoría 90 días", currency: "USD" }]) => {
  const i = fromFathomMeeting(m)!;
  return { title: i.title, callDay: "2026-10-08", invitees: i.invitees, summaryEn: i.summaryEn, actionItemsEn: i.actionItemsEn, transcriptText: i.transcriptText, offers };
};

test("runCallBrief: summary + action items + transcript tail in ONE call; Spanish rules in the prompt", async () => {
  const { model, prompts } = mockModel(briefJson());
  const r = await runCallBrief(brief(fixture("fathom-meeting-es.json")), model);
  assert.equal(prompts.length, 1);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.outcome, "SEGUIMIENTO");
  assert.match(r.oneLine, /esposo/);
  const p = prompts[0];
  assert.match(p, /RESUMEN_FATHOM\n## Summary\nLaura wants/);
  assert.match(p, /ACCIONES_FATHOM\n\[00:50:20\] \(Kali\) Send Laura the payment link/);
  assert.match(p, /\[00:50:02\] Laura Gómez: Sí, el viernes a las 3/);
  assert.match(p, /FECHA_LLAMADA: 2026-10-08/);
  assert.match(p, /- Mentoría 90 días \(moneda USD\)/);
  assert.match(p, /Escribe todos los textos en español neutro/);
  assert.match(p, /- Laura Gómez · laura\.gomez@gmail\.com · externo: sí/);
});

test("runCallBrief: null summary → brief from the transcript, «resumen_fathom» in faltantes", async () => {
  const { model, prompts } = mockModel(briefJson({ cliente_real: "Pedro Ruiz", estado_lead: "perdido", citas: [], venta_total: null }));
  const r = await runCallBrief(brief(fixture("fathom-meeting-null-summary.json")), model);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.match(prompts[0], /RESUMEN_FATHOM\n\(no hay: Fathom no resumió esta llamada/);
  assert.match(prompts[0], /\[00:41:07\] Pedro Ruiz: Que cierre el contrato grande/);
  assert.ok(r.brief.faltantes.includes("resumen_fathom"));
  assert.equal(r.outcome, "PERDIDO");
});

test("runCallBrief: English call (docs example) still asks for Spanish; failures are explicit (no retry loop)", async () => {
  const ok = mockModel(briefJson({ cliente_real: "John Smith", una_linea: "Revisaron el presupuesto; John espera la propuesta revisada." }));
  const r = await runCallBrief(brief(fixture("fathom-meeting-en.json")), ok.model);
  assert.ok(r.ok && /presupuesto/.test(r.oneLine));
  assert.match(ok.prompts[0], /We reviewed Q1 OKRs/);
  const failing = mockModel(new Error("503"));
  assert.deepEqual(await runCallBrief(brief(fixture("fathom-meeting-en.json")), failing.model), { ok: false, reason: "MODEL" });
  assert.equal(failing.prompts.length, 1);
  const bad = mockModel("{ esto no es json");
  assert.deepEqual(await runCallBrief(brief(fixture("fathom-meeting-en.json")), bad.model), { ok: false, reason: "INVALID" });
  const none = mockModel(briefJson());
  const empty = { title: "x", callDay: "2026-10-08", invitees: [], summaryEn: null, actionItemsEn: null, transcriptText: null, offers: [] };
  assert.deepEqual(await runCallBrief(empty, none.model), { ok: false, reason: "NO_CONTENT" });
  assert.equal(none.prompts.length, 0);
  assert.deepEqual(await runCallBrief(brief(fixture("fathom-meeting-en.json")), null), { ok: false, reason: "MODEL" });
});

test("transcript excerpt: last ~15 minutes plus the money/date windows before them", () => {
  const lines: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    const ts = `00:${String(i).padStart(2, "0")}:00`;
    lines.push(i === 10 ? `[${ts}] Kali: El precio es 2.000 dólares de contado.` : `[${ts}] Ana: comentario número ${i} sobre su negocio`);
  }
  const ex = transcriptExcerpt(lines.join("\n"))!;
  assert.match(ex, /El precio es 2\.000 dólares/);
  assert.match(ex, /comentario número 9 /); // context line before the money line
  assert.match(ex, /comentario número 59/);
  assert.match(ex, /comentario número 44/);
  assert.doesNotMatch(ex, /comentario número 30 /);
  assert.match(ex, /\[…\]/);
  // untimed text keeps its last 12k characters
  const big = Array.from({ length: 2000 }, (_, i) => `Hablante: línea ${i}`).join("\n");
  const ex2 = transcriptExcerpt(big)!;
  assert.ok(ex2.length <= 12_100 && /línea 1999$/.test(ex2));
});

test("proposals: never merge automatically; one match → update it, none → create, two → create with candidates", () => {
  const b = parseBrief(briefJson({ estado_lead: "cerrado" }))!;
  const inv = [{ name: "Laura Gómez", email: "laura.gomez@gmail.com" }];
  const none = proposalsFor(b, "CERRO", inv, [], "off1");
  assert.deepEqual(none.map((p) => p.kind), ["CREATE_LEAD", "SET_STATUS"]);
  assert.equal(none[0].preview, "Agregar a Laura Gómez a tus personas");
  assert.equal(none[1].preview, "Marcar a Laura Gómez como venta cerrada");
  const one = proposalsFor(b, "CERRO", inv, [{ id: "L1", name: "Laura G." }], null);
  assert.deepEqual(one.map((p) => [p.kind, p.leadId]), [["UPDATE_LEAD", "L1"], ["SET_STATUS", "L1"]]);
  const two = proposalsFor(b, "SEGUIMIENTO", inv, [{ id: "L1", name: "a" }, { id: "L2", name: "b" }], null);
  assert.deepEqual(two.map((p) => p.kind), ["CREATE_LEAD"]);
  assert.deepEqual((two[0].payload as { possibleMatches: string[] }).possibleMatches, ["L1", "L2"]);
  const nobody = proposalsFor(parseBrief(briefJson({ cliente_real: null }))!, "CERRO", [], [], null);
  assert.deepEqual(nobody, []);
});

// ---------- Fathom client (fake fetch; never Fathom) ----------

test("Fathom client: one request per call, summary/action items/transcript asked, 429 → Retry-After without retrying", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let status = 200;
  const fake = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (status === 429) return new Response("", { status: 429, headers: { "Retry-After": "30" } });
    if (url.includes("/webhooks") && init.method === "POST") return Response.json({ id: "wh_1", secret: TEST_WEBHOOK_SECRET });
    if (init.method === "DELETE") return new Response("", { status: 404 });
    return Response.json({ limit: 10, next_cursor: "c2", items: [fixture("fathom-meeting-es.json")] });
  };
  const c = fathomClient("test-key-not-real", fake);
  const page = await c.listMeetings({ createdAfter: "2026-08-12T15:00:00.000Z", cursor: "c1" });
  assert.equal(page.nextCursor, "c2");
  assert.equal(page.items.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, "https://api.fathom.ai/external/v1/meetings");
  for (const k of ["include_summary", "include_action_items", "include_transcript"]) assert.equal(u.searchParams.get(k), "true");
  assert.equal(u.searchParams.get("created_after"), "2026-08-12T15:00:00.000Z");
  assert.equal(u.searchParams.get("cursor"), "c1");
  assert.equal((calls[0].init.headers as Record<string, string>)["X-Api-Key"], "test-key-not-real");

  const hook = await c.createWebhook("https://app.example/api/fathom/webhook/tok");
  assert.deepEqual(hook, { id: "wh_1", secret: TEST_WEBHOOK_SECRET });
  const body = JSON.parse(String(calls[1].init.body));
  assert.deepEqual(body.triggered_for, ["my_recordings", "shared_external_recordings"]);
  assert.equal(body.include_summary, true);
  assert.equal(body.include_action_items, true);
  assert.equal(body.include_transcript, true);
  await c.deleteWebhook("wh_old"); // 404 = already gone, fine

  status = 429;
  const before = calls.length;
  await assert.rejects(c.listMeetings({ createdAfter: "x" }), (e: unknown) => e instanceof FathomRateLimited && e.retryAfterSec === 30);
  assert.equal(calls.length, before + 1);
  assert.equal(retryAfterSeconds(null), 60);
  assert.equal(retryAfterSeconds("0"), 1);
});

test("webhook signature: HMAC of id.timestamp.body with the whsec_ secret; tampered or old → rejected", () => {
  const body = readFileSync(path.join(FIX, "fathom-webhook-docs.json"), "utf8");
  const h = signedHeaders(body, { id: "msg_2x2zwLOcWaRTzsLK8KtbQt1FTk9" });
  assert.equal(verifyFathomWebhookSignature(TEST_WEBHOOK_SECRET, h, body), true);
  assert.equal(verifyFathomWebhookSignature(TEST_WEBHOOK_SECRET, h, body.replace("Quarterly", "Monthly")), false);
  const old = signedHeaders(body, { at: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal(verifyFathomWebhookSignature(TEST_WEBHOOK_SECRET, old, body), false);
  const other = signedHeaders(body, { secret: `whsec_${Buffer.from("otro").toString("base64")}` });
  assert.equal(verifyFathomWebhookSignature(TEST_WEBHOOK_SECRET, other, body), false);
});

// ---------- Arquitectura's answers for Metas ----------

test("answer 1: weekly follow-ups hint = ceil(Σ max(0, 6 − attempts) / 3); none without people or with nothing missing", () => {
  // 2 people at 0, 1 at 3, 1 at 5, plus 1 already at 7 (not in the groups)
  assert.deepEqual(followupsHint([{ attempts: 0, people: 2 }, { attempts: 3, people: 1 }, { attempts: 5, people: 1 }], 5), { people: 5, perWeek: 6 });
  assert.deepEqual(followupsHint([{ attempts: 5, people: 1 }], 1), { people: 1, perWeek: 1 });
  assert.equal(followupsHint([], 0), null);
  assert.equal(followupsHint([], 4), null); // everyone already has 6+
});

test("answer 3: goal ideas only from her own last month (same, +20 %, +50 %), any currency; none without history", () => {
  assert.deepEqual(goalIdeas(null), []);
  assert.deepEqual(goalIdeas(0), []);
  assert.deepEqual(goalIdeas(150_000).map((i) => [i.cents, i.label]), [[150_000, "igual"], [180_000, "+20%"], [225_000, "+50%"]]);
  // whole units (COP has big numbers; nothing is a fixed amount)
  assert.deepEqual(goalIdeas(123_456_789).map((i) => i.cents), [123_456_800, 148_148_100, 185_185_200]);
  assert.deepEqual(goalIdeas(50).map((i) => i.cents), [100]); // tiny amounts collapse to one idea
});

test("answer 1/2/3 in the screen: ≈ before the meetings, the follow-ups hint text, no fixed USD ideas", () => {
  const parts = readFileSync(path.join(SRC, "app/(v2)/metas/parts.tsx"), "utf8");
  assert.match(parts, /Te sugiero ≈ \$\{plural\(w\.suggestion\.meetings/);
  assert.match(parts, /a 6 intentos en 3 semanas: unos \{w\.followupsHint\.perWeek\} por semana/);
  assert.doesNotMatch(parts, /GOAL_IDEAS_CENTS|200_000|currency === "USD"/);
  const metrics = readFileSync(path.join(SRC, "lib/metrics/metas.ts"), "utf8");
  assert.doesNotMatch(metrics, /GOAL_IDEAS_CENTS/);
});

// ---------- answer 5: hidden, not «Muy pronto» ----------

test("answer 5: no «Muy pronto» in v2 screens; every hidden link is registered and used through showLink", () => {
  const v2 = appFiles.filter((f) => rel(f).startsWith("app/(v2)/") || rel(f).startsWith("components/v2/"));
  const pronto = v2.filter((f) => /muy pronto/i.test(readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(pronto, []);
  const code = v2.map((f) => readFileSync(f, "utf8")).join("\n");
  for (const id of Object.keys(HIDDEN_LINKS)) assert.ok(code.includes(`showLink("${id}")`), `${id} not used`);
  for (const m of code.matchAll(/showLink\("([^"]+)"\)/g)) assert.ok(m[1] in HIDDEN_LINKS, `${m[1]} not registered`);
});

test("cutover: no hidden links remain", { skip: "the cutover PR turns this on: HIDDEN_LINKS must be empty" }, () => {
  assert.deepEqual(Object.keys(HIDDEN_LINKS), []);
});

// ---------- guards ----------

test("guard: CallTranscript is written once at ingest and read back only by «Reintentar» (retryCallBrief)", () => {
  const bad: string[] = [];
  for (const f of appFiles) {
    const r = rel(f);
    const code = stripComments(readFileSync(f, "utf8"));
    const touches = /\bcallTranscript\b|"CallTranscript"|\btranscript\s*:\s*\{\s*select/.test(code);
    if (touches && r !== "lib/write/ingest.ts") bad.push(r);
  }
  assert.deepEqual(bad, []);
  const write = stripComments(readFileSync(path.join(SRC, "lib/write/ingest.ts"), "utf8"));
  const reads = [...write.matchAll(/transcript\s*:\s*\{\s*select/g)];
  assert.equal(reads.length, 1);
  const retry = write.slice(write.indexOf("export async function retryCallBrief"), write.indexOf("type BriefSource"));
  assert.match(retry, /transcript\s*:\s*\{\s*select/);
  // the fresh brief passes the in-memory text
  const fresh = write.slice(write.indexOf("export async function briefIngestedCall"), write.indexOf("export async function retryCallBrief"));
  assert.match(fresh, /transcriptText: input\.transcriptText/);
});

test("guard: no cron and no polling for ingestion (Neon Free)", () => {
  const vercel = path.join(SRC, "../vercel.json");
  const crons = (() => {
    try {
      return JSON.parse(readFileSync(vercel, "utf8")).crons ?? [];
    } catch {
      return [];
    }
  })();
  assert.deepEqual(crons, []);
  const ingest = appFiles.filter((f) => /lib\/ingest\/|app\/\(v2\)\/|app\/api\/fathom\/webhook\//.test(rel(f)));
  const bad = ingest.filter((f) => /setInterval|router\.refresh|refreshInterval|revalidate\s*=\s*\d/.test(stripComments(readFileSync(f, "utf8")))).map(rel);
  assert.deepEqual(bad, []);
  // the burst only starts from «Conectar» and from a Hoy visit
  const callers = appFiles.filter((f) => /runBackfillBurst\(/.test(stripComments(readFileSync(f, "utf8")))).map(rel).sort();
  assert.deepEqual(callers, ["app/(v2)/ofertas/calls-actions.ts", "app/(v2)/page.tsx", "lib/ingest/backfill.ts"]);
});

test("guard: the rebuild window is a 60-day constant; the brief model is pinned by name", () => {
  const write = readFileSync(path.join(SRC, "lib/write/ingest.ts"), "utf8");
  assert.match(write, /export const BACKFILL_WINDOW_DAYS = 60;/);
  const b = stripComments(readFileSync(path.join(SRC, "lib/ingest/brief.ts"), "utf8"));
  assert.match(b, /BRIEF_MODEL = "gemini-[\d.]+-flash"/);
  assert.doesNotMatch(b, /-latest/);
});

test("Mis ofertas says «Si Fathom no resume una llamada, súbela»", () => {
  assert.match(readFileSync(path.join(SRC, "app/(v2)/ofertas/calls.tsx"), "utf8"), /Si Fathom no resume una llamada, súbela\./);
});

test("brief prompt contains D1 verbatim rules", () => {
  const p = buildBriefPrompt({ title: "t", callDay: "2026-10-08", invitees: [], summaryEn: null, actionItemsEn: null, transcriptText: "[00:00:01] A: hola", offers: [] });
  assert.match(p, /2\. Montos: solo si se dijo una cifra explícita para ESTE cliente/);
  assert.match(p, /9\. producto: exactamente un nombre del CATALOGO, o null/);
});
