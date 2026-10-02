import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  applyChatProposal,
  interpretCrmChat,
  loadLeadTranscript,
  looksLikeFilingAnswer,
  messageTargetsOtherLead,
  proposalFromLoosePatch,
  replyForNamedLead,
  respondToCrmChat,
  type ChatContext,
  type ChatLead,
  type ChatProposal,
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

test("a later question about Carlos does not keep Sofía's pending change", async () => {
  const pending: ChatProposal = {
    leadId: "sofia",
    leadName: "Sofía Mamani",
    changes: [
      { field: "name", label: "Nombre", from: "Sofía Mamani", to: "Sofia Mamani Quispe" },
    ],
  };
  const turn = interpretCrmChat(
    "Con Carlos Ramírez no recuerdo en qué quedamos, revisa el transcript",
    { ...ctx, pending },
  );
  assert.equal(turn.kind, "answer");
  if (turn.kind !== "answer") return;
  assert.match(turn.reply, /Carlos Ramírez/);
  assert.doesNotMatch(turn.reply, /Edson/);
  assert.doesNotMatch(turn.reply, /Sofia Mamani Quispe/);

  const { prisma, calls } = fakeCrm();
  const reply = await respondToCrmChat(prisma, "user-1", "Con Carlos Ramírez no recuerdo en qué quedamos, revisa el transcript", {
    ...ctx,
    pending,
  });
  assert.match(reply || "", /Dejé sin confirmar el cambio anterior/);
  assert.match(reply || "", /Carlos Ramírez/);
  assert.equal(calls.includes("updateMany"), false);
  assert.ok(calls.includes("pending:clear"));
});

test("sí applies the stored rename without updateMany", async () => {
  const { prisma, calls } = fakeCrm();
  const pending: ChatProposal = {
    leadId: "sofia",
    leadName: "Sofía Mamani",
    changes: [
      { field: "name", label: "Nombre", from: "Sofía Mamani", to: "Sofia Mamani Quispe" },
    ],
  };
  const reply = await respondToCrmChat(prisma, "user-1", "sí", {
    ...ctx,
    pending,
    offers: ["Círculo Millonario"],
  });
  assert.match(reply || "", /Listo/);
  assert.match(reply || "", /Sofia Mamani Quispe/);
  assert.equal(calls.includes("updateMany"), false);
  assert.ok(calls.some((call) => call.startsWith("raw:")));
  assert.ok(calls.some((call) => call.startsWith("lead:")));
  assert.ok(calls.includes("pending:clear"));
});

test("no cancels the stored change and writes nothing", async () => {
  const { prisma, calls } = fakeCrm();
  const pending: ChatProposal = {
    leadId: "sofia",
    leadName: "Sofía Mamani",
    changes: [
      { field: "name", label: "Nombre", from: "Sofía Mamani", to: "Sofia Mamani Quispe" },
    ],
  };
  const reply = await respondToCrmChat(prisma, "user-1", "no", { ...ctx, pending });
  assert.match(reply || "", /No cambié nada/);
  assert.equal(calls.some((call) => call.startsWith("lead:")), false);
  assert.ok(calls.includes("pending:clear"));
});

test("a database failure while applying stays a reply and does not throw", async () => {
  const { prisma } = fakeCrm({ failUpdate: true });
  const pending: ChatProposal = {
    leadId: "sofia",
    leadName: "Sofía Mamani",
    changes: [
      { field: "name", label: "Nombre", from: "Sofía Mamani", to: "Sofia Mamani Quispe" },
    ],
  };
  const reply = await respondToCrmChat(prisma, "user-1", "sí", { ...ctx, pending });
  assert.match(reply || "", /El chat sigue activo/);
  assert.doesNotMatch(reply || "", /Recarga/);
});

test("free text is not saved as an offer", async () => {
  const turn = interpretCrmChat("El producto de Edson es Quedamos en que el viernes", {
    ...ctx,
    offers: ["Círculo Millonario", "Fertilidad Consciente"],
  });
  assert.equal(turn.kind, "answer");
  if (turn.kind !== "answer") return;
  assert.match(turn.reply, /no es una oferta/);
  assert.match(turn.reply, /Fertilidad Consciente/);
  assert.match(turn.reply, /No cambié nada/);

  const { prisma, calls } = fakeCrm();
  const result = await applyChatProposal(
    prisma,
    "user-1",
    {
      leadId: "edson",
      leadName: "Edson",
      changes: [
        {
          field: "offer",
          label: "Producto/Oferta",
          from: "Círculo Millonario",
          to: "Quedamos en que el viernes",
        },
      ],
    },
    ["Círculo Millonario", "Fertilidad Consciente"],
  );
  assert.match(result.reply, /no es una oferta/);
  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call.startsWith("lead:")), false);
});

test("a real offer can be confirmed for that lead only", () => {
  const turn = interpretCrmChat("El producto de Edson es Fertilidad Consciente", {
    ...ctx,
    offers: ["Círculo Millonario", "Fertilidad Consciente"],
  });
  assert.equal(turn.kind, "confirm");
  if (turn.kind !== "confirm") return;
  assert.equal(turn.proposal.leadId, "edson");
  assert.equal(turn.proposal.changes[0]?.field, "offer");
  assert.equal(turn.proposal.changes[0]?.to, "Fertilidad Consciente");
  assert.match(turn.reply, /¿Confirmo\?/);
});

test("recall quotes the linked transcript and the saved agreement", () => {
  const turn = interpretCrmChat(
    "Con Carlos Ramírez no recuerdo en qué quedamos, revisa el transcript",
    {
      ...ctx,
      calls: [
        {
          leadName: "Carlos Ramírez",
          acuerdo: "Llamar el viernes para cerrar tras hablarlo con la socia",
          notas: "",
          proximo: "2026-10-02 10:00",
          transcript:
            "[00:12] Carlos: Lo hablo con mi socia.\n[00:40] Closer: Entonces quedamos en llamar el viernes para cerrar.",
        },
      ],
    },
  );
  assert.equal(turn.kind, "answer");
  if (turn.kind !== "answer") return;
  assert.match(turn.reply, /Llamar el viernes para cerrar tras hablarlo con la socia/);
  assert.match(turn.reply, /En el transcript/);
  assert.match(turn.reply, /socia/);
  assert.doesNotMatch(turn.reply, /No hay un transcript enlazado/);
  assert.doesNotMatch(turn.reply, /Edson/);
});

test("rename plus transcript does not write the agreement into the offer", () => {
  const turn = interpretCrmChat(
    "Edson se llama Etson, no recuerdo en qué quedamos, revisa el transcript",
    {
      ...ctx,
      calls: [
        {
          leadName: "Edson",
          acuerdo: "",
          notas: "llamada incompleta",
          proximo: "",
          transcript:
            "Edson lleva diez años en iluminación en Arequipa. Closer: quedamos en retomar la conversación el viernes.",
        },
      ],
    },
  );
  assert.equal(turn.kind, "confirm");
  if (turn.kind !== "confirm") return;
  assert.equal(turn.proposal.leadId, "edson");
  assert.deepEqual(
    turn.proposal.changes.map((change) => change.field),
    ["name"],
  );
  assert.equal(turn.proposal.changes[0]?.to, "Etson");
  assert.match(turn.reply, /En el transcript/);
  assert.match(turn.reply, /viernes/);
  assert.doesNotMatch(turn.reply, /Producto/);
});

test("a loose model patch follows the lead named in this message", () => {
  const turn = proposalFromLoosePatch(
    {
      name: "Edson",
      offerName: "Quedamos en que el viernes",
      amountPaid: "2000",
    },
    { ...ctx, offers: ["Círculo Millonario"] },
    "Carlos me pagó la reserva de 2000 USD",
  );
  assert.equal(turn.kind, "confirm");
  if (turn.kind !== "confirm") return;
  assert.equal(turn.proposal.leadId, "carlos");
  assert.equal(turn.proposal.changes.some((change) => change.field === "offer"), false);
  assert.equal(turn.proposal.changes.some((change) => change.field === "cash"), true);
  assert.match(turn.reply, /Carlos Ramírez/);
  assert.match(turn.reply, /no es una oferta/);
  assert.doesNotMatch(turn.reply, /Edson/);
});

test("a reply about another lead is replaced with the one named now", () => {
  const reply = replyForNamedLead(
    "¿Cuál fue el valor de la venta con Edson?",
    "Carlos me pagó la reserva de 2000 USD",
    leads,
  );
  assert.match(reply, /Carlos Ramírez/);
  assert.doesNotMatch(reply, /Edson/);
});

test("loadLeadTranscript uses the call linked to that lead", async () => {
  const transcript =
    "Closer: hola Carlos. Carlos: quedamos en llamar el viernes después de hablarlo con la socia para cerrar.";
  const prisma = {
    fathomRecording: {
      findFirst: async () => ({ transcriptText: transcript }),
      findMany: async () => [],
    },
    clientTranscript: {
      findFirst: async () => null,
      findMany: async () => [],
    },
  } as unknown as PrismaClient;
  const text = await loadLeadTranscript(prisma, "user-1", "Carlos Ramírez", [
    { leadName: "Carlos Ramírez", source: "fathom", sourceId: "rec-1" },
  ]);
  assert.match(text, /socia/);
});

function fakeCrm(opts?: { failUpdate?: boolean }) {
  const calls: string[] = [];
  const prefs: Record<string, unknown> = {};
  const prisma = {
    lead: {
      findFirst: async () => ({
        id: "sofia",
        name: "Sofía Mamani",
        offerName: "Círculo Millonario",
      }),
      update: async ({ data }: { data: { name?: string } }) => {
        if (opts?.failUpdate) throw new Error("Transactions are not supported");
        calls.push(`lead:${data.name || ""}`);
        return data;
      },
    },
    callRecord: {
      updateMany: async () => {
        calls.push("updateMany");
        throw new Error("Transactions are not supported");
      },
      findFirst: async () => ({ id: "call-1", filingJson: { notas_crm: "vieja" } }),
      update: async () => {
        calls.push("call");
      },
    },
    $executeRaw: async (strings: TemplateStringsArray) => {
      calls.push(`raw:${strings.join(" ")}`);
      return 1;
    },
    user: {
      findUnique: async () => ({ crmPrefs: { ...prefs } }),
      update: async ({ data }: { data: { crmPrefs: Record<string, unknown> } }) => {
        for (const key of Object.keys(prefs)) delete prefs[key];
        Object.assign(prefs, data.crmPrefs);
        calls.push(data.crmPrefs.pendingChat ? "pending:set" : "pending:clear");
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, calls, prefs };
}

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
