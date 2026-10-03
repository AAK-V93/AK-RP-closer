import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalOfferName,
  isChatRequest,
  keptOfferName,
  leadClarifyReply,
  leadMention,
  planCallProductoRepair,
  planLeadProductoRepair,
  planProductoWrite,
  planUserProductoDryRun,
  stripFalseListo,
} from "./producto-guard";

const offers = [
  { productName: "Círculo Millonario", aliases: ["circulo", "circulo millonario"] },
  { productName: "Equipo Millonario", aliases: ["equipo"] },
];

test("producto keeps a saved offer and maps accent, case and alias", () => {
  const exact = planProductoWrite("Círculo Millonario", offers);
  assert.equal(exact.action, "keep");
  assert.equal(exact.producto, "Círculo Millonario");

  const folded = planProductoWrite("circulo millonario", offers);
  assert.equal(folded.action, "alias");
  assert.equal(folded.producto, "Círculo Millonario");
  assert.equal(canonicalOfferName("CÍRCULO MILLONARIO", offers), "Círculo Millonario");

  const alias = planProductoWrite("circulo", offers);
  assert.equal(alias.action, "alias");
  assert.equal(alias.producto, "Círculo Millonario");
  assert.equal(alias.acuerdo, "");
  assert.equal(alias.ignore, false);
});

test("the two production strings never stay in producto", () => {
  const acuerdo = planProductoWrite("Quedamos en que el viernes me avisaba", offers);
  assert.equal(acuerdo.action, "acuerdo");
  assert.equal(acuerdo.producto, "");
  assert.equal(acuerdo.acuerdo, "Quedamos en que el viernes me avisaba");
  assert.equal(acuerdo.ignore, false);

  const request = planProductoWrite(
    "Porfa, dame la lista de seguimientos entera, con fecha y todo lo que tengas",
    offers,
  );
  assert.equal(request.action, "request");
  assert.equal(request.producto, "");
  assert.equal(request.acuerdo, "");
  assert.equal(request.ignore, true);
  assert.equal(isChatRequest(request.acuerdo || "Porfa, dame la lista de seguimientos entera"), true);
});

test("an unknown label is cleared and is not treated as an agreement", () => {
  const plan = planProductoWrite("MENTORIAS", offers);
  assert.equal(plan.action, "clear");
  assert.equal(plan.producto, "");
  assert.equal(plan.acuerdo, "");
});

test("Etsson asks about Edson and does not select him", () => {
  const leads = [
    { id: "edson", name: "Edson García" },
    { id: "kim", name: "Kimlen Garcia" },
  ];
  const mention = leadMention("Etsson me pagó la reserva de 2000", leads);
  assert.equal(mention.kind, "clarify");
  if (mention.kind !== "clarify") return;
  assert.equal(mention.candidates.length, 1);
  assert.equal(mention.candidates[0]?.name, "Edson García");
  const reply = leadClarifyReply(mention.candidates);
  assert.match(reply, /¿Te refieres a Edson García\?/);
  assert.match(reply, /No cambié nada/);
  assert.doesNotMatch(reply, /^Listo/i);

  const exact = leadMention("Edson García se llama Etson", leads);
  assert.equal(exact.kind, "exact");
  if (exact.kind !== "exact") return;
  assert.equal(exact.lead.id, "edson");
});

test("listo only survives a write that names the lead", () => {
  assert.equal(stripFalseListo("Listo, actualicé a Etsson.", false), "No cambié nada.");
  assert.equal(stripFalseListo("Listo, cancelé eso. No cambié nada.", false), "Cancelé eso. No cambié nada.");
  assert.match(stripFalseListo("Listo. En Edson García quedó: Cobrado «2000».", true, "Edson García"), /Edson García/);
  assert.match(stripFalseListo("Listo.", true, "Edson García"), /Edson García/);
});

test("the dry-run classifier maps, moves or clears without writing", () => {
  const alias = planLeadProductoRepair(
    { id: "1", name: "Ana", offerName: "circulo", nextStep: "", lastSummary: "" },
    offers,
  );
  assert.equal(alias?.action, "alias");
  assert.equal(alias?.proposal, "mapear a «Círculo Millonario»");
  assert.equal(alias?.data.offerName, "Círculo Millonario");

  const moved = planLeadProductoRepair(
    {
      id: "edson",
      name: "Edson",
      offerName: "Quedamos en que el viernes me avisaba",
      nextStep: "",
      lastSummary: "",
    },
    offers,
  );
  assert.equal(moved?.action, "acuerdo");
  assert.equal(moved?.proposal, "mover el texto a acuerdo");
  assert.equal(moved?.data.offerName, "");
  assert.equal(moved?.data.nextStep, "Quedamos en que el viernes me avisaba");

  const cleared = planLeadProductoRepair(
    {
      id: "kim",
      name: "Kimlen Garcia",
      offerName: "Porfa, dame la lista de seguimientos entera",
      nextStep: "Llamar el lunes",
      lastSummary: "",
    },
    offers,
  );
  assert.equal(cleared?.action, "request");
  assert.equal(cleared?.proposal, "borrar (petición al chat)");
  assert.equal(cleared?.data.offerName, "");
  assert.equal(cleared?.data.nextStep, undefined);

  assert.equal(
    planLeadProductoRepair(
      { id: "ok", name: "Ana", offerName: "Círculo Millonario", nextStep: "", lastSummary: "" },
      offers,
    ),
    null,
  );

  const call = planCallProductoRepair(
    {
      id: "call-1",
      leadName: "Edson",
      offerName: "Quedamos en que el viernes me avisaba",
      producto: "Quedamos en que el viernes me avisaba",
      acuerdo: "",
      notas: "",
    },
    offers,
  );
  assert.equal(call?.rows.length, 1);
  assert.equal(call?.rows[0]?.action, "acuerdo");
  assert.equal(call?.offerName, "");
  assert.equal(call?.producto, "");
  assert.equal(call?.acuerdo, "Quedamos en que el viernes me avisaba");
});

test("an empty offer list keeps the existing offerName", () => {
  assert.equal(keptOfferName("MENTORIAS", "Círculo Millonario", []), "Círculo Millonario");
  assert.equal(
    keptOfferName("Quedamos en que el viernes me avisaba", "Equipo Millonario", []),
    "Equipo Millonario",
  );
  const unread = planProductoWrite("MENTORIAS", []);
  assert.equal(unread.action, "unread");
  assert.equal(unread.producto, "");
  assert.equal(
    planLeadProductoRepair(
      { id: "1", name: "Ana", offerName: "Círculo Millonario", nextStep: "", lastSummary: "" },
      [],
    ),
    null,
  );
});

test("a rejected new producto keeps the existing valid offerName", () => {
  assert.equal(keptOfferName("MENTORIAS", "Círculo Millonario", offers), "Círculo Millonario");
  assert.equal(
    keptOfferName("Quedamos en que el viernes me avisaba", "Círculo Millonario", offers),
    "Círculo Millonario",
  );
  assert.equal(keptOfferName("equipo", "Círculo Millonario", offers), "Equipo Millonario");
  assert.equal(keptOfferName("", "Círculo Millonario", offers), "Círculo Millonario");
});

test("a user with no offers is skipped by the dry-run planner", () => {
  const skipped = planUserProductoDryRun({
    offers: [],
    leads: [
      { id: "1", name: "Edson", offerName: "Quedamos en que el viernes me avisaba" },
      { id: "2", name: "Kimlen", offerName: "Porfa, dame la lista de seguimientos entera" },
    ],
    calls: [{ id: "c", leadName: "Edson", offerName: "MENTORIAS", producto: "MENTORIAS" }],
  });
  assert.equal(skipped.skipped, true);
  if (!skipped.skipped) return;
  assert.match(skipped.note, /Sin ofertas guardadas/);
  assert.equal("lines" in skipped, false);

  const listed = planUserProductoDryRun({
    offers,
    leads: [
      {
        id: "1",
        name: "Edson",
        offerName: "Quedamos en que el viernes me avisaba",
        nextStep: "",
        lastSummary: "",
      },
      {
        id: "2",
        name: "Kimlen",
        offerName: "Porfa, dame la lista de seguimientos entera",
        nextStep: "",
        lastSummary: "",
      },
      { id: "3", name: "Ana", offerName: "MENTORIAS", nextStep: "", lastSummary: "" },
    ],
    calls: [],
  });
  assert.equal(listed.skipped, false);
  if (listed.skipped) return;
  assert.deepEqual(listed.offers, ["Círculo Millonario", "Equipo Millonario"]);
  const byName = Object.fromEntries(listed.lines.map((line) => [line.leadName, line]));
  assert.equal(byName.Edson?.action, "acuerdo");
  assert.equal(byName.Edson?.proposal, "mover el texto a acuerdo");
  assert.equal(byName.Kimlen?.action, "request");
  assert.equal(byName.Kimlen?.proposal, "borrar (petición al chat)");
  assert.equal(byName.Ana?.action, "clear");
  assert.equal(byName.Ana?.proposal, "borrar (no es una oferta)");
});
