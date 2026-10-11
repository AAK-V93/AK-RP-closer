// PR 3 writes and reads on a local throwaway Postgres only (same refusal
// rules as the other *.db.test.ts files).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { readOfferCases, readOfferScripts, readOffersPage } from "@/lib/read/offers";
import { addCaseSources, addManualCase, saveCaseReview, syncCaseSource } from "@/lib/write/cases";
import { archiveOffer, deleteScript, upsertOffer, upsertScript } from "@/lib/write/offers";
import { saveDriveConnection } from "@/lib/write/drive";
import { decryptSecret } from "@/lib/secret-crypto";

const WEB = path.resolve(__dirname, "../..");
const url = process.env.TEST_DATABASE_URL?.trim() ?? "";
const hostOf = (raw: string) => {
  try {
    const u = new URL(raw);
    return u.searchParams.get("host") || u.hostname;
  } catch {
    return "";
  }
};
const isLocal = (raw: string) => /^(localhost|127\.0\.0\.1|\/)/.test(hostOf(raw)) && !/neon/i.test(raw);
const skip = !url ? "set TEST_DATABASE_URL to a local throwaway Postgres" : !isLocal(url) ? "refusing: only localhost is allowed" : false;

let db: PrismaClient;
let userId = "";
let otherId = "";
const tagsSeen: string[] = [];
const opts = { revalidate: (t: string) => void tagsSeen.push(t) };

before(async () => {
  if (skip) return;
  execFileSync(path.join(WEB, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: WEB, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  db = new PrismaClient({ datasourceUrl: url });
  const stamp = Date.now();
  userId = (await db.user.create({ data: { email: `ofertas-${stamp}@example.test` }, select: { id: true } })).id;
  otherId = (await db.user.create({ data: { email: `ofertas-other-${stamp}@example.test` }, select: { id: true } })).id;
});

after(async () => {
  await db?.$disconnect();
});

test("offers: create, edit, commission flows to the offer's people, empty page reads", { skip }, async () => {
  const empty = await readOffersPage(db, userId);
  assert.deepEqual(empty.offers, []);
  assert.deepEqual(empty.fathom, { connected: false, lastSyncAt: null });

  const created = await upsertOffer(db, userId, { name: "Fertilidad Consciente", currency: "USD", priceCash: "2.000" }, opts);
  assert.ok(created.ok);
  const lead = await db.lead.create({ data: { userId, name: "Gina", nameNorm: "gina", offerId: created.id }, select: { id: true } });
  const foreignLead = await db.lead.create({ data: { userId: otherId, name: "X", nameNorm: "x" }, select: { id: true } });

  // PCT without cash price: por confirmar
  await upsertOffer(db, userId, { id: created.id, name: "Fertilidad Consciente", currency: "USD", priceCash: null, installmentsCount: 3, installmentAmount: "700", commissionType: "PCT_SALE", commissionValue: "10" }, opts);
  let l = await db.lead.findUnique({ where: { id: lead.id }, select: { potentialCommission: true } });
  assert.equal(l?.potentialCommission, null);

  await upsertOffer(db, userId, { id: created.id, name: "Fertilidad Consciente", currency: "USD", priceCash: "2000", commissionType: "PCT_SALE", commissionValue: "10" }, opts);
  l = await db.lead.findUnique({ where: { id: lead.id }, select: { potentialCommission: true } });
  assert.equal(l?.potentialCommission?.toString(), "200");
  assert.ok(tagsSeen.includes(`u:${userId}:offers`) && tagsSeen.includes(`u:${userId}:leads`));
  const fl = await db.lead.findUnique({ where: { id: foreignLead.id }, select: { potentialCommission: true } });
  assert.equal(fl?.potentialCommission, null);

  // another user cannot edit or archive it
  assert.deepEqual(await upsertOffer(db, otherId, { id: created.id, name: "Mía", currency: "USD" }, opts), { ok: false, error: "No encontré esa oferta" });
  assert.deepEqual(await archiveOffer(db, otherId, created.id, opts), { ok: false, error: "No encontré esa oferta" });

  const page = await readOffersPage(db, userId);
  assert.equal(page.offers.length, 1);
  assert.deepEqual(
    { ...page.offers[0], id: "" },
    { id: "", name: "Fertilidad Consciente", description: "", currency: "USD", priceCash: "2000", installmentsCount: null, installmentAmount: null,
      commissionType: "PCT_SALE", commissionValue: "10", scripts: 0, cases: 0, sources: 0, casesToReview: 0 },
  );
});

test("scripts: CRUD, take 8 + «Ver más», scoped to the user", { skip }, async () => {
  const offer = await upsertOffer(db, userId, { name: "Círculo Millonario", currency: "USD", priceCash: "10000", commissionType: "PER_CLOSE", commissionValue: "900" }, opts);
  assert.ok(offer.ok);
  for (let i = 0; i < 10; i += 1) {
    const r = await upsertScript(db, userId, { offerId: offer.id, title: `Guion ${i}`, body: "Hola, ¿cómo vas?", origin: i === 0 ? "EMPRESA" : undefined }, opts);
    assert.ok(r.ok);
  }
  const first = await readOfferScripts(db, userId, offer.id, false);
  assert.equal(first.scripts.length, 8);
  assert.equal(first.hasMore, true);
  assert.equal((await readOfferScripts(db, userId, offer.id, true)).scripts.length, 10);
  assert.deepEqual(await upsertScript(db, otherId, { id: first.scripts[0].id, offerId: null, title: "x", body: "y" }, opts), { ok: false, error: "No encontré ese guion" });
  assert.deepEqual(await deleteScript(db, otherId, first.scripts[0].id, opts), { ok: false, error: "No encontré ese guion" });
  assert.deepEqual(await deleteScript(db, userId, first.scripts[0].id, opts), { ok: true });
  assert.equal((await readOffersPage(db, userId)).offers.find((o) => o.id === offer.id)?.scripts, 9);
  assert.deepEqual(await archiveOffer(db, userId, offer.id, opts), { ok: true });
  assert.equal((await readOffersPage(db, userId)).offers.some((o) => o.id === offer.id), false);
});

test("success cases: review keeps corrections across re-syncs; same hash → no model call", { skip }, async () => {
  const offer = await upsertOffer(db, userId, { name: "Casos", currency: "USD" }, opts);
  assert.ok(offer.ok);
  let csv = "Nombre,Antes,Resultado,Video\nAna,2 clientes,9 clientes al mes,https://youtu.be/aaaaaaaaaaa\nLuis,,Facturó USD 10.000,\nEva,,,\n";
  const fetchCsv = (async () => new Response(csv, { status: 200, headers: { "content-type": "text/csv" } })) as unknown as typeof fetch;
  let modelCalls = 0;
  const model = async () => {
    modelCalls += 1;
    return JSON.stringify({ cases: [{ i: 0, name: "Eva", result: "ganó USD 99.999" }] });
  };

  const added = await addCaseSources(db, userId, offer.id, "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvW/edit\nhttps://example.com/x", opts);
  assert.ok(added.ok);
  assert.equal(added.added.length, 1);
  assert.equal(added.invalid.length, 1);
  const sourceId = added.added[0];
  assert.deepEqual(await addCaseSources(db, otherId, offer.id, "https://youtu.be/aaaaaaaaaaa", opts), { ok: false, error: "No encontré esa oferta" });

  const s1 = await syncCaseSource(db, userId, sourceId, { fetch: fetchCsv, model }, opts);
  assert.ok(s1.ok);
  assert.deepEqual({ ...s1.result, modelCalls: 0 }, { status: "READY", message: null, found: 3, added: 3, changed: 0, missing: 0, modelCalls: 0 });
  assert.equal(modelCalls, 1); // only Eva (no clear columns) went to the model

  let cases = await readOfferCases(db, userId, offer.id);
  assert.equal(cases.confirmed.length, 0); // nothing is suggested before review
  assert.equal(cases.toReview.length, 3);
  const eva = cases.toReview.find((c) => c.nameExtracted === "Eva")!;
  assert.equal(eva.resultExtracted, null); // USD 99.999 is not in the row
  const ana = cases.toReview.find((c) => c.nameExtracted === "Ana")!;
  const luis = cases.toReview.find((c) => c.nameExtracted === "Luis")!;
  assert.equal(ana.externalKey, "yt:aaaaaaaaaaa");

  const review = await saveCaseReview(db, userId, offer.id, [
    { id: ana.id, name: "Ana María", profile: null, before: "2 clientes", result: "9 clientes al mes", decision: "confirm" },
    { id: luis.id, decision: "confirm" },
    { id: eva.id, decision: "dismiss" },
  ], opts);
  assert.deepEqual(review, { ok: true, confirmed: 2, dismissed: 1 });
  const page = (await readOffersPage(db, userId)).offers.find((o) => o.id === offer.id)!;
  assert.deepEqual([page.cases, page.casesToReview, page.sources], [2, 0, 1]);

  // same content: no model call, nothing rewritten
  modelCalls = 0;
  const s2 = await syncCaseSource(db, userId, sourceId, { fetch: fetchCsv, model }, opts);
  assert.ok(s2.ok && s2.result.found === 0 && s2.result.added === 0);
  assert.equal(modelCalls, 0);

  // the sheet changes: Ana's row changes, Luis disappears
  csv = "Nombre,Antes,Resultado,Video\nAna,2 clientes,12 clientes al mes,https://youtu.be/aaaaaaaaaaa\nEva,,,\n";
  const s3 = await syncCaseSource(db, userId, sourceId, { fetch: fetchCsv, model }, opts);
  assert.ok(s3.ok);
  assert.deepEqual([s3.result.changed, s3.result.missing, s3.result.added], [1, 1, 0]);
  const rows = await db.successCase.findMany({
    where: { userId, offerId: offer.id }, take: 10,
    select: { nameExtracted: true, nameUser: true, resultExtracted: true, resultUser: true, confirmedAt: true, dismissed: true, missingFromSourceAt: true },
  });
  const anaRow = rows.find((r) => r.nameExtracted === "Ana")!;
  assert.equal(anaRow.resultExtracted, "12 clientes al mes");
  assert.equal(anaRow.nameUser, "Ana María"); // correction kept
  assert.ok(anaRow.confirmedAt);
  assert.equal(rows.find((r) => r.nameExtracted === "Eva")!.dismissed, true);
  assert.ok(rows.find((r) => r.nameExtracted === "Luis")!.missingFromSourceAt);

  cases = await readOfferCases(db, userId, offer.id);
  assert.deepEqual(cases.confirmed.map((c) => c.nameUser ?? c.nameExtracted), ["Ana María"]);
  assert.equal(cases.missing.length, 1);

  // a case typed by hand is confirmed at once; another user's source is not readable
  const manual = await addManualCase(db, userId, offer.id, { name: "Sol", profile: null, before: null, result: "Primera venta", quote: null, mediaUrl: null }, opts);
  assert.ok(manual.ok);
  assert.equal((await readOfferCases(db, userId, offer.id)).confirmed.length, 2);
  assert.deepEqual(await syncCaseSource(db, otherId, sourceId, { fetch: fetchCsv, model }, opts), { ok: false, error: "No encontré ese enlace" });
  assert.equal((await readOfferCases(db, otherId, offer.id)).sources.length, 0);
});

test("a sheet that is not shared says so plainly", { skip }, async () => {
  const offer = await upsertOffer(db, userId, { name: "Privada", currency: "USD" }, opts);
  assert.ok(offer.ok);
  const added = await addCaseSources(db, userId, offer.id, "https://docs.google.com/spreadsheets/d/1ZyXwVuTsRqPoNmLkJiHgFe/edit", opts);
  assert.ok(added.ok);
  const login = (async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  const r = await syncCaseSource(db, userId, added.added[0], { fetch: login, model: null }, opts);
  assert.ok(r.ok && r.result.status === "NEEDS_ACCESS");
  const src = (await readOfferCases(db, userId, offer.id)).sources[0];
  assert.equal(src.status, "NEEDS_ACCESS");
  assert.match(src.lastError ?? "", /Cualquier persona con el enlace/);
});

test("Drive connection: one row per user, token stored encrypted, page shows it", { skip }, async () => {
  process.env.AUTH_SECRET ||= "test-secret";
  await saveDriveConnection(db, userId, { refreshToken: "r1", scope: "https://www.googleapis.com/auth/drive.file" }, opts);
  await saveDriveConnection(db, userId, { refreshToken: "r2", scope: "https://www.googleapis.com/auth/drive.file" }, opts);
  const rows = await db.googleDriveConnection.findMany({ where: { userId }, take: 5, select: { refreshTokenEnc: true } });
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].refreshTokenEnc, "r2");
  assert.equal(decryptSecret(rows[0].refreshTokenEnc), "r2");
  assert.equal((await readOffersPage(db, userId)).driveConnected, true);
  assert.equal((await readOffersPage(db, otherId)).driveConnected, false);
});
