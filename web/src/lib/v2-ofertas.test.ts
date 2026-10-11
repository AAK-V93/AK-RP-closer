// PR 3 (Mis ofertas): completeness, commission per close, success-case links,
// CSV, keys, figure guard, re-sync rules and extraction without inventing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bestScriptId, commissionPerClose, offerCompleteness, perCloseCommission, scriptUsage } from "@/lib/metrics";
import { parseCsv } from "@/lib/cases/csv";
import { extractCases, parseModelCases } from "@/lib/cases/extract";
import { guardFigures } from "@/lib/cases/figures";
import { caseKey, mapHeaders, sheetItems, videoItems } from "@/lib/cases/items";
import { parseCaseLink, parseCaseLinks, sheetCsvUrl } from "@/lib/cases/links";
import { type Loaded, MSG, loadSource } from "@/lib/cases/load";
import { planSync } from "@/lib/cases/merge";
import { caseFields, isSuggestible, userValue } from "@/lib/cases/view";
import { readDriveState, signDriveState } from "@/lib/cases/drive";
import { formatMoney } from "@/lib/format/money";
import { parseAmount, validateOffer } from "@/lib/write/offers";

const base = {
  priceCash: "10000",
  installmentsCount: 3,
  installmentAmount: "3600",
  commissionType: "PER_CLOSE" as const,
  commissionValue: "900",
  scripts: 6,
  cases: 34,
  casesToReview: 0,
};

test("commission per close: PER_CLOSE, PCT_SALE, PCT_CASH on the cash price", () => {
  assert.equal(commissionPerClose({ commissionType: "PER_CLOSE", commissionValue: "900", priceCash: null }), 90000);
  assert.equal(commissionPerClose({ commissionType: "PCT_SALE", commissionValue: "9", priceCash: "10000" }), 90000);
  assert.equal(commissionPerClose({ commissionType: "PCT_CASH", commissionValue: "12.5", priceCash: "2000" }), 25000);
  assert.equal(commissionPerClose({ commissionType: null, commissionValue: "900", priceCash: "10000" }), null);
});

test("offerCompleteness: «Completa» only with price, commission, a script and a confirmed case", () => {
  const full = offerCompleteness(base);
  assert.equal(full.complete, true);
  assert.equal(full.next, null);
  assert.deepEqual(full.perClose, { cents: 90000, missing: null });

  const noCases = offerCompleteness({ ...base, cases: 0 });
  assert.equal(noCases.complete, false);
  assert.deepEqual(noCases.next, { key: "CASES", text: "Todavía no tiene casos de éxito para sugerir", action: "Agregar enlaces", tab: "casos" });

  // read but not confirmed yet → review, still not complete
  const review = offerCompleteness({ ...base, cases: 0, casesToReview: 12 });
  assert.equal(review.next?.key, "REVIEW_CASES");
  assert.equal(review.next?.text, "Tienes 12 casos por revisar antes de sugerirlos");

  const empty = offerCompleteness({
    priceCash: null, installmentsCount: null, installmentAmount: null, commissionType: null, commissionValue: null,
    scripts: 0, cases: 0, casesToReview: 0,
  });
  assert.deepEqual(empty.steps.map((s) => s.key), ["PRICE", "COMMISSION", "SCRIPTS", "CASES"]);
  assert.equal(empty.next?.action, "Agregar precio");

  // installments only is a price, but a percentage still needs the cash price
  const pct = offerCompleteness({ ...base, priceCash: null, commissionType: "PCT_SALE", commissionValue: "10" });
  assert.deepEqual(pct.steps.map((s) => s.key), ["CASH_PRICE"]);
  assert.deepEqual(pct.perClose, { cents: null, missing: "PRICE" });
  assert.equal(offerCompleteness({ ...base, scripts: 0 }).next?.action, "Agregar guion");
});

test("C: PCT without priceCash is «por confirmar», never from installments", () => {
  const r = perCloseCommission({ commissionType: "PCT_CASH", commissionValue: "10", priceCash: null });
  assert.deepEqual(r, { cents: null, missing: "PRICE" });
});

test("scripts: «El que mejor funciona» needs real results and one clear winner", () => {
  const rows = [
    { id: "a", usesCount: 12, repliesCount: 5, paidCount: 0 },
    { id: "b", usesCount: 9, repliesCount: 4, paidCount: 4 },
    { id: "c", usesCount: 0, repliesCount: 0, paidCount: 0 },
  ];
  assert.equal(bestScriptId(rows), "b");
  assert.equal(bestScriptId([rows[2]]), null);
  assert.equal(bestScriptId([{ id: "x", usesCount: 3, repliesCount: 1, paidCount: 0 }, { id: "y", usesCount: 4, repliesCount: 1, paidCount: 0 }]), null);
  assert.deepEqual(scriptUsage(rows[0]), { used: "Lo usaste 12 veces", replies: "5 respondieron", paid: null });
  assert.deepEqual(scriptUsage(rows[1]).paid, "4 pagaron");
  assert.deepEqual(scriptUsage({ id: "z", usesCount: 1, repliesCount: 1, paidCount: 1 }), { used: "Lo usaste 1 vez", replies: "1 respondió", paid: "1 pagó" });
  assert.equal(scriptUsage(rows[2]).used, "Todavía no lo usas");
});

test("links: sheets, playlists, channels, videos; junk explained", () => {
  const sheet = parseCaseLink("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=42");
  assert.deepEqual(sheet.ok && [sheet.kind, sheet.externalId, sheet.gid], ["SHEET", "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789#42", "42"]);
  assert.equal(sheetCsvUrl("ID", "42"), "https://docs.google.com/spreadsheets/d/ID/export?format=csv&gid=42");
  const pl = parseCaseLink("https://www.youtube.com/playlist?list=PL1234567890abcdef");
  assert.deepEqual(pl.ok && [pl.kind, pl.externalId], ["YOUTUBE_PLAYLIST", "PL1234567890abcdef"]);
  const v = parseCaseLink("https://youtu.be/dQw4w9WgXcQ?si=x");
  assert.deepEqual(v.ok && [v.kind, v.externalId], ["YOUTUBE_VIDEO", "dQw4w9WgXcQ"]);
  const short = parseCaseLink("https://www.youtube.com/shorts/dQw4w9WgXcQ");
  assert.deepEqual(short.ok && short.externalId, "dQw4w9WgXcQ");
  const ch = parseCaseLink("https://www.youtube.com/@CirculoMillonario/videos");
  assert.deepEqual(ch.ok && [ch.kind, ch.externalId], ["YOUTUBE_CHANNEL", "@CirculoMillonario"]);
  const bad = parseCaseLink("https://drive.google.com/file/d/abc");
  assert.equal(bad.ok, false);
  assert.equal(parseCaseLink("hola").ok, false);
  const many = parseCaseLinks("https://youtu.be/dQw4w9WgXcQ\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ , https://www.youtube.com/playlist?list=PLx");
  assert.equal(many.length, 2); // same video once
});

test("CSV: quotes, commas, newlines in cells, BOM", () => {
  const rows = parseCsv('\uFEFFNombre,Resultado\r\n"Ana, coach","Pasó de 2 a 9 clientes\nen 3 meses"\r\nLuis,"Dijo ""gracias"""\n\n');
  assert.deepEqual(rows, [["Nombre", "Resultado"], ["Ana, coach", "Pasó de 2 a 9 clientes\nen 3 meses"], ["Luis", 'Dijo "gracias"']]);
});

test("keys: same video in a sheet and a playlist is one case; rows without link are stable", () => {
  assert.equal(caseKey("Ana", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"), "yt:dQw4w9WgXcQ");
  assert.equal(videoItems([{ videoId: "dQw4w9WgXcQ", title: "Ana", description: "" }])[0].externalKey, "yt:dQw4w9WgXcQ");
  assert.equal(caseKey("Ana María", null), caseKey("  ana maria ", null));
  assert.notEqual(caseKey("Ana", null), caseKey("Luis", null));
  assert.equal(caseKey("x", "https://Vimeo.com/123/?a=1"), "url:https://vimeo.com/123");
});

test("sheet rows: columns by header, snippet is the row itself", () => {
  const map = mapHeaders(["Nombre del cliente", "Perfil", "Antes", "Resultado", "Video"]);
  assert.deepEqual(map, { name: 0, profile: 1, before: 2, result: 3, quote: -1, mediaUrl: 4 });
  const items = sheetItems([
    ["Nombre", "Perfil", "Antes", "Resultado", "Video"],
    ["Ana", "Coach de nutrición", "2 clientes al mes", "9 clientes al mes en 3 meses", "https://youtu.be/dQw4w9WgXcQ"],
    ["", "", "", "", ""],
    ["Luis", "", "", "Facturó USD 10.000", ""],
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].externalKey, "yt:dQw4w9WgXcQ");
  assert.equal(items[0].hints.result, "9 clientes al mes en 3 meses");
  assert.match(items[0].snippet, /^Nombre: Ana\nPerfil: Coach de nutrición/);
  assert.equal(items[1].hints.mediaUrl, null);
});

test("figures: a result may only cite numbers that are in the snippet", () => {
  const snippet = "Resultado: pasó de USD 2.000 a USD 10,000 al mes en 3 meses";
  assert.equal(guardFigures("De USD 2000 a USD 10.000 en 3 meses", snippet), "De USD 2000 a USD 10.000 en 3 meses");
  assert.equal(guardFigures("De USD 2.000 a USD 12.000", snippet), null);
  assert.equal(guardFigures("Duplicó sus ventas", snippet), "Duplicó sus ventas");
  assert.equal(guardFigures("  ", snippet), null);
  assert.equal(guardFigures("3,5 veces más", "creció 3.5 veces"), "3,5 veces más");
});

test("extraction: no model needed for clear rows; model figures not in the snippet are dropped; links never from the model", async () => {
  const items = [
    ...sheetItems([["Nombre", "Resultado"], ["Ana", "9 clientes al mes"]]),
    ...videoItems([
      { videoId: "aaaaaaaaaaa", title: "Testimonio de Marta", description: "Marta, odontóloga, pasó de 4 a 20 pacientes." },
      { videoId: "bbbbbbbbbbb", title: "Cómo hacer una oferta", description: "Clase 3" },
    ]),
  ];
  const prompts: string[] = [];
  const model = async (p: string) => {
    prompts.push(p);
    return JSON.stringify({
      cases: [
        { i: 0, name: "Marta", profile: "Odontóloga", before: "4 pacientes", result: "20 pacientes y USD 50.000", quote: null, mediaUrl: "https://evil" },
        { i: 1, name: null },
      ],
    });
  };
  const { cases, modelCalls } = await extractCases(items, { model, titles: new Map([["yt:aaaaaaaaaaa", "Testimonio de Marta"]]) });
  assert.equal(modelCalls, 1);
  assert.doesNotMatch(prompts[0], /Ana/); // the clear sheet row did not go to the model
  assert.deepEqual(cases.map((c) => c.externalKey), [items[0].externalKey, "yt:aaaaaaaaaaa"]); // the class is not a case
  const marta = cases[1].fields;
  assert.equal(marta.result, null); // USD 50.000 is not in the snippet
  assert.equal(marta.before, "4 pacientes");
  assert.equal(marta.mediaUrl, "https://www.youtube.com/watch?v=aaaaaaaaaaa");

  // without a model: what the source says plainly, title as name, nothing else
  const plain = await extractCases(items, { model: null, titles: new Map([["yt:aaaaaaaaaaa", "Testimonio de Marta"]]) });
  assert.equal(plain.modelCalls, 0);
  assert.equal(plain.cases.length, 3);
  assert.deepEqual(plain.cases[1].fields, { name: "Testimonio de Marta", profile: null, before: null, result: null, quote: null, mediaUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa" });
  assert.deepEqual(parseModelCases("not json", 2), [null, null]);
});

test("re-sync plan: corrections kept, only changed rows rewritten, gone rows marked", () => {
  const f = (name: string, result: string | null = null) => ({ name, profile: null, before: null, result, quote: null, mediaUrl: null });
  const existing = [
    { id: "1", externalKey: "k1", sourceId: "s", sourceSnippet: "a", missingFromSourceAt: null, extracted: f("Ana", "9") },
    { id: "2", externalKey: "k2", sourceId: "s", sourceSnippet: "b", missingFromSourceAt: null, extracted: f("Luis") },
    { id: "3", externalKey: "k3", sourceId: "s", sourceSnippet: "c", missingFromSourceAt: null, extracted: f("Eva") },
    { id: "4", externalKey: "k4", sourceId: "other", sourceSnippet: "d", missingFromSourceAt: null, extracted: f("Sol") },
    { id: "5", externalKey: "k5", sourceId: "s", sourceSnippet: "e", missingFromSourceAt: "2026-10-01T00:00:00Z", extracted: f("Leo") },
  ];
  const plan = planSync("s", existing, [
    { externalKey: "k1", snippet: "a", fields: f("Ana", "9") }, // unchanged
    { externalKey: "k2", snippet: "b2", fields: f("Luis", "3") }, // changed
    { externalKey: "k5", snippet: "e", fields: f("Leo") }, // came back
    { externalKey: "k6", snippet: "f", fields: f("Nuevo") }, // new
  ]);
  assert.deepEqual(plan.inserts.map((i) => i.externalKey), ["k6"]);
  assert.deepEqual(plan.updates.map((u) => u.id), ["2"]);
  assert.deepEqual(plan.missing, ["3"]); // k4 belongs to another source
  assert.deepEqual(plan.back, ["5"]);
  assert.equal(plan.unchanged, 2);
  assert.equal("nameUser" in plan.updates[0].fields, false);
});

test("case view: the person's words win; suggested only once confirmed", () => {
  const row = {
    nameExtracted: "Ana", profileExtracted: "coach", beforeExtracted: null, resultExtracted: "9 clientes", quoteExtracted: null, mediaUrlExtracted: null,
    nameUser: null, profileUser: "Coach de nutrición", beforeUser: null, resultUser: "", quoteUser: null, mediaUrlUser: null,
    confirmedAt: null, dismissed: false, missingFromSourceAt: null,
  };
  assert.deepEqual(caseFields(row), { name: "Ana", profile: "Coach de nutrición", before: null, result: "", quote: null, mediaUrl: null });
  assert.equal(isSuggestible(row), false);
  assert.equal(isSuggestible({ ...row, confirmedAt: "2026-10-11T00:00:00Z" }), true);
  assert.equal(isSuggestible({ ...row, confirmedAt: "2026-10-11T00:00:00Z", dismissed: true }), false);
  assert.equal(userValue("Ana ", "Ana"), null);
  assert.equal(userValue("Ana María", "Ana"), "Ana María");
  assert.equal(userValue("", "Ana"), "");
});

test("loader: link-shared sheet, no access, unchanged hash, YouTube without key", async () => {
  const csv = "Nombre,Resultado\nAna,9 clientes\n";
  const ok = (body: string, type = "text/csv") => async () => new Response(body, { status: 200, headers: { "content-type": type } });
  const ref = { kind: "SHEET" as const, access: "PUBLIC_LINK" as const, externalId: "1AbCdEfGhIjKlMnOpQrStUvW", contentHash: null };
  const first = (await loadSource(ref, { fetch: ok(csv) as typeof fetch })) as Extract<Loaded, { status: "OK" }>;
  assert.equal(first.status, "OK");
  assert.equal(first.items.length, 1);
  assert.deepEqual(await loadSource({ ...ref, contentHash: first.hash }, { fetch: ok(csv) as typeof fetch }), { status: "UNCHANGED", hash: first.hash });
  assert.deepEqual(await loadSource(ref, { fetch: ok("<html>login</html>", "text/html") as typeof fetch }), { status: "NEEDS_ACCESS", message: MSG.sheetNoAccess });
  assert.deepEqual(
    await loadSource(ref, { fetch: (async () => new Response("", { status: 403 })) as typeof fetch }),
    { status: "NEEDS_ACCESS", message: MSG.sheetNoAccess },
  );
  assert.deepEqual(await loadSource({ ...ref, access: "DRIVE_PICKER" }, { fetch: ok(csv) as typeof fetch, driveToken: async () => null }), {
    status: "NEEDS_ACCESS", message: MSG.driveNotConnected,
  });
  assert.deepEqual(await loadSource({ kind: "YOUTUBE_PLAYLIST", access: "PUBLIC_LINK", externalId: "PL1", contentHash: null }, { youtubeKey: null }), {
    status: "ERROR", message: MSG.youtubeOff,
  });
});

test("loader: YouTube playlist uses title + description only, skips private videos", async () => {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({
      items: [
        { snippet: { title: "Marta", description: "pasó de 4 a 20", resourceId: { videoId: "aaaaaaaaaaa" } } },
        { snippet: { title: "Private video", description: "", resourceId: { videoId: "bbbbbbbbbbb" } } },
      ],
    }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = (await loadSource({ kind: "YOUTUBE_PLAYLIST", access: "PUBLIC_LINK", externalId: "PL1", contentHash: null }, { fetch: f, youtubeKey: "k" })) as Extract<Loaded, { status: "OK" }>;
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].snippet, "Marta\npasó de 4 a 20");
  assert.ok(calls.every((u) => u.includes("/playlistItems?") && !/search|captions/.test(u)));
});

test("drive state is signed, bound to the user and expires", () => {
  process.env.AUTH_SECRET ||= "test-secret";
  const s = signDriveState({ userId: "u1", offerId: "o1" }, 1_000);
  assert.equal(readDriveState(s, "u1", 2_000)?.offerId, "o1");
  assert.equal(readDriveState(s, "u2", 2_000), null);
  assert.equal(readDriveState(s, "u1", 1_000 + 11 * 60_000), null);
  assert.equal(readDriveState(`${s}x`, "u1", 2_000), null);
});

test("offer form: amounts as people type them, clear errors", () => {
  assert.equal(parseAmount("10.000"), "10000");
  assert.equal(parseAmount("USD 1.500,50"), "1500.50");
  assert.equal(parseAmount("900"), "900");
  assert.equal(parseAmount(""), null);
  assert.throws(() => parseAmount("mil"));
  assert.deepEqual(validateOffer({ name: " ", currency: "USD" }), { ok: false, error: "Ponle un nombre a la oferta" });
  assert.deepEqual(validateOffer({ name: "X", currency: "USD", commissionType: "PCT_SALE", commissionValue: "150" }), {
    ok: false, error: "El porcentaje va de 0 a 100",
  });
  const v = validateOffer({ name: "Círculo", currency: "usd", priceCash: "10.000", commissionType: null, commissionValue: "900" });
  assert.ok(v.ok && v.data.currency === "USD" && v.data.priceCash === "10000" && v.data.commissionValue === null);
  assert.equal(formatMoney("10000", "USD"), "USD 10.000");
  assert.equal(formatMoney("1500.5", "USD"), "USD 1.500,50");
  assert.equal(formatMoney(null, "USD"), null);
});
