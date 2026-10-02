import assert from "node:assert/strict";
import test from "node:test";
import {
  interpretCrmChat,
  looksLikeFilingAnswer,
  messageTargetsOtherLead,
  type ChatContext,
  type ChatLead,
} from "./hub-crm-chat";

const leads: ChatLead[] = [
  {
    id: "sofia",
    name: "Sofía Mamani",
    offerName: "Círculo Millonario",
    nextStep: "",
    lastSummary: "",
    amountPaid: "",
  },
  {
    id: "carlos",
    name: "Carlos Ramírez",
    offerName: "Círculo Millonario",
    nextStep: "Llamar el viernes para cerrar tras hablarlo con la socia",
    lastSummary: "",
    amountPaid: "",
  },
  {
    id: "edson",
    name: "Edson",
    offerName: "Círculo Millonario",
    nextStep: "",
    lastSummary: "llamada incompleta",
    amountPaid: "",
  },
];

const ctx: ChatContext = {
  leads,
  calls: [
    {
      leadName: "Carlos Ramírez",
      acuerdo: "Llamar el viernes para cerrar tras hablarlo con la socia",
      notas: "",
      proximo: "2026-10-02 10:00",
    },
  ],
  pending: null,
  now: new Date("2026-10-01T12:00:00.000Z"),
};

test("a rename proposes the new name and does not write", () => {
  const turn = interpretCrmChat(
    "Sofía Mamani en realidad se llama Sofia Mamani Quispe",
    ctx,
  );
  assert.equal(turn.kind, "confirm");
  if (turn.kind !== "confirm") return;
  assert.equal(turn.proposal.leadId, "sofia");
  assert.equal(turn.proposal.changes[0]?.field, "name");
  assert.equal(turn.proposal.changes[0]?.to, "Sofia Mamani Quispe");
  assert.match(turn.reply, /¿Confirmo\?/);
  assert.equal(turn.proposal.changes.some((change) => change.field === "name"), true);
});

test("recall returns the saved agreement for the named lead", () => {
  const turn = interpretCrmChat(
    "Con Carlos Ramírez no recuerdo en qué quedamos, revisa el transcript",
    ctx,
  );
  assert.equal(turn.kind, "answer");
  if (turn.kind !== "answer") return;
  assert.match(turn.reply, /Llamar el viernes para cerrar tras hablarlo con la socia/);
  assert.match(turn.reply, /Carlos Ramírez/);
  assert.doesNotMatch(turn.reply, /Edson/);
});

test("a meeting time is a confirmation for that lead", () => {
  const turn = interpretCrmChat(
    "Con Sofia quedamos de vernos el viernes 9 de octubre a las 5 pm",
    ctx,
  );
  assert.equal(turn.kind, "confirm");
  if (turn.kind !== "confirm") return;
  assert.equal(turn.proposal.leadId, "sofia");
  assert.equal(
    turn.proposal.changes.find((change) => change.field === "nextStepAt")?.to,
    "2026-10-09 17:00",
  );
});

test("a payment names Carlos and not Edson", () => {
  const turn = interpretCrmChat("Carlos me pagó la reserva de 2000 USD", ctx);
  assert.equal(turn.kind, "confirm");
  if (turn.kind !== "confirm") return;
  assert.equal(turn.proposal.leadId, "carlos");
  assert.equal(turn.proposal.changes[0]?.to, "2000");
  assert.match(turn.reply, /Carlos Ramírez/);
  assert.doesNotMatch(turn.reply, /Edson/);
});

test("sí applies the stored proposal and no drops it", () => {
  const pending = {
    leadId: "sofia",
    leadName: "Sofía Mamani",
    changes: [
      { field: "name" as const, label: "Nombre", from: "Sofía Mamani", to: "Sofia Mamani Quispe" },
    ],
  };
  const yes = interpretCrmChat("sí", { ...ctx, pending });
  assert.equal(yes.kind, "apply");
  const no = interpretCrmChat("no", { ...ctx, pending });
  assert.equal(no.kind, "drop");
});

test("those messages are not answers to Edson's filing gap", () => {
  const samples = [
    "Sofía Mamani en realidad se llama Sofia Mamani Quispe",
    "Con Carlos Ramírez no recuerdo en qué quedamos, revisa el transcript",
    "Con Sofia quedamos de vernos el viernes 9 de octubre a las 5 pm",
    "Carlos me pagó la reserva de 2000 USD",
    "Quedamos en que el viernes",
  ];
  for (const sample of samples) {
    assert.equal(looksLikeFilingAnswer(sample), false, sample);
  }
  assert.equal(looksLikeFilingAnswer("10000"), true);
  assert.equal(messageTargetsOtherLead("Carlos me pagó 2000", leads, "Edson"), true);
  assert.equal(messageTargetsOtherLead("10000", leads, "Edson"), false);
});
