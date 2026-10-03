import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { missingOfferSetupPhrase } from "./offer-commercial";
import { getHomeState } from "./home-state";
import { retryRead } from "./read-retry";
import {
  answerCrmChat,
  applyChatProposal,
  asksForMoneyStats,
  bareMoneyPeriod,
  asksForPendingDesk,
  deskQuestionKind,
  chatCapabilitiesReply,
  crmReadFailureReply,
  cobradoFromCalls,
  formatMoneyStats,
  looksLikeOfferSetup,
  recognizedCrmQuestion,
  guardCoachReply,
  offerPasteReplyAllowed,
  OFFER_PASTE_TEXT,
  interpretCrmChat,
  loadLeadTranscript,
  looksLikeFilingAnswer,
  readPendingChat,
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
      update: async ({ data }: { data: { name?: string; amountPaid?: string } }) => {
        if (opts?.failUpdate) throw new Error("Transactions are not supported");
        calls.push(`lead:${data.name || ""}`);
        if (data.amountPaid != null) calls.push(`paid:${data.amountPaid}`);
        return data;
      },
    },
    callRecord: {
      updateMany: async () => {
        calls.push("updateMany");
        throw new Error("Transactions are not supported");
      },
      findMany: async () => {
        calls.push("findMany");
        return [
          { id: "call-sofia", leadName: "Sofía Mamani", title: "", filingJson: {} },
          {
            id: "call-quispe",
            leadName: "Sofia Mamani Quispe",
            title: "Sofia Mamani Quispe",
            filingJson: { cliente_real: "Sofia Mamani Quispe" },
          },
          { id: "call-1", leadName: "Carlos Ramírez", title: "", filingJson: { notas_crm: "vieja" } },
        ];
      },
      findFirst: async () => ({ id: "call-1", filingJson: { notas_crm: "vieja" }, leadName: "Carlos Ramírez", title: "" }),
      update: async (args?: { data?: { cashCollected?: number; leadName?: string } }) => {
        calls.push("call");
        if (args?.data && "cashCollected" in args.data) calls.push(`callcash:${args.data.cashCollected}`);
        if (args?.data?.leadName) calls.push(`callname:${args.data.leadName}`);
      },
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(" ");
      calls.push(`raw:${sql}`);
      calls.push(`vals:${values.map((value) => String(value)).join("|")}`);
      if (sql.includes(" - ") && values.includes("pendingChat")) {
        delete prefs.pendingChat;
        calls.push("pending:clear");
      } else if (sql.includes("jsonb_set") && values.includes("pendingChat")) {
        const json = values.find((value) => typeof value === "string" && value.trim().startsWith("{"));
        if (typeof json === "string") prefs.pendingChat = JSON.parse(json);
        calls.push("pending:set");
      }
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

test("re-sending the same rename re-asks and writes nothing", async () => {
  const pending: ChatProposal = {
    leadId: "sofia",
    leadName: "Sofía Mamani",
    changes: [
      { field: "name", label: "Nombre", from: "Sofía Mamani", to: "Sofia Mamani Quispe" },
    ],
  };
  const again = interpretCrmChat("Sofía Mamani en realidad se llama Sofia Mamani Quispe", {
    ...ctx,
    pending,
  });
  assert.equal(again.kind, "confirm");
  if (again.kind !== "confirm") return;
  assert.equal(again.proposal.changes[0]?.to, "Sofia Mamani Quispe");
  assert.match(again.reply, /¿Confirmo\?/);
  assert.doesNotMatch(again.reply, /ya está guardado/);
  assert.doesNotMatch(again.reply, /Dejé sin confirmar/);

  const { prisma, calls } = fakeCrm();
  const reply = await respondToCrmChat(
    prisma,
    "user-1",
    "Sofía Mamani en realidad se llama Sofia Mamani Quispe",
    { ...ctx, pending },
  );
  assert.match(reply || "", /¿Confirmo\?/);
  assert.doesNotMatch(reply || "", /ya está guardado/);
  assert.doesNotMatch(reply || "", /Dejé sin confirmar/);
  assert.equal(calls.some((call) => call.startsWith("lead:")), false);
  assert.equal(calls.includes("updateMany"), false);
  assert.ok(calls.includes("pending:set"));
  assert.equal(calls.includes("pending:clear"), false);
});

test("a stored name that already matches still re-asks while that rename is pending", () => {
  const pending: ChatProposal = {
    leadId: "sofia",
    leadName: "Sofía Mamani",
    changes: [
      { field: "name", label: "Nombre", from: "Sofía Mamani", to: "Sofia Mamani Quispe" },
    ],
  };
  const renamed = ctx.leads.map((lead) =>
    lead.id === "sofia" ? { ...lead, name: "Sofia Mamani Quispe" } : lead,
  );
  const turn = interpretCrmChat("Sofía Mamani en realidad se llama Sofia Mamani Quispe", {
    ...ctx,
    leads: renamed,
    pending,
  });
  assert.equal(turn.kind, "confirm");
  if (turn.kind !== "confirm") return;
  assert.match(turn.reply, /¿Confirmo\?/);
  assert.doesNotMatch(turn.reply, /ya está guardado/);
});

test("a pending change from another conversation is ignored", () => {
  const foreign = readPendingChat({
    pendingChat: {
      conversation: "import",
      leadId: "alejandro",
      leadName: "Alejandro",
      changes: [{ field: "name", label: "Nombre", from: "Alejandro", to: "Alex" }],
    },
  });
  assert.equal(foreign, null);
  const hub = readPendingChat({
    pendingChat: {
      conversation: "hub",
      leadId: "sofia",
      leadName: "Sofía Mamani",
      changes: [
        { field: "name", label: "Nombre", from: "Sofía Mamani", to: "Sofia Mamani Quispe" },
      ],
    },
  });
  assert.equal(hub?.leadId, "sofia");
  assert.equal(hub?.changes[0]?.to, "Sofia Mamani Quispe");
});

test("sí without a pending change does not touch another record", async () => {
  const turn = interpretCrmChat("sí", ctx);
  assert.equal(turn.kind, "answer");
  if (turn.kind !== "answer") return;
  assert.match(turn.reply, /No tengo ningún cambio pendiente/);
  assert.doesNotMatch(turn.reply, /Alejandro/);
  assert.doesNotMatch(turn.reply, /listo/);

  const { prisma, calls } = fakeCrm();
  const reply = await respondToCrmChat(prisma, "user-1", "sí", ctx);
  assert.match(reply || "", /No tengo ningún cambio pendiente/);
  assert.equal(calls.some((call) => call.startsWith("lead:")), false);
  assert.equal(calls.includes("call"), false);
});

test("clearing Carlos's cash asks before writing zero", async () => {
  const paid = {
    ...ctx,
    leads: ctx.leads.map((lead) => (lead.id === "carlos" ? { ...lead, amountPaid: "2000" } : lead)),
  };
  for (const sample of [
    "Carlos no ha pagado nada",
    "pon el cash de Carlos en 0",
    "borra el pago de Carlos",
  ]) {
    const turn = interpretCrmChat(sample, paid);
    assert.equal(turn.kind, "confirm", sample);
    if (turn.kind !== "confirm") return;
    assert.equal(turn.proposal.leadId, "carlos");
    assert.equal(turn.proposal.changes[0]?.field, "cash");
    assert.equal(turn.proposal.changes[0]?.to, "0");
    assert.equal(turn.proposal.changes[0]?.label, "Cobrado");
    assert.match(turn.reply, /Cobrado/);
    assert.match(turn.reply, /¿Confirmo\?/);
  }

  const { prisma, calls } = fakeCrm();
  const reply = await respondToCrmChat(prisma, "user-1", "sí", {
    ...paid,
    pending: {
      leadId: "carlos",
      leadName: "Carlos Ramírez",
      changes: [{ field: "cash", label: "Cash cobrado", from: "2000", to: "0" }],
    },
  });
  assert.match(reply || "", /Listo/);
  assert.match(reply || "", /«0»/);
  assert.ok(calls.includes("paid:0"));
  assert.ok(calls.includes("callcash:0"));
  assert.equal(calls.includes("updateMany"), false);
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
  assert.equal(looksLikeFilingAnswer("sí"), false);
  assert.equal(looksLikeFilingAnswer("si"), false);
  assert.equal(messageTargetsOtherLead("Carlos me pagó 2000", leads, "Edson"), true);
  assert.equal(messageTargetsOtherLead("10000", leads, "Edson"), false);
});

test("a rename compares the CRM name exactly, accents included", () => {
  const withCrm = ctx.leads.map((lead) =>
    lead.id === "sofia" ? { ...lead, crmName: "Sofia Mamani Quispe" } : lead,
  );
  const turn = interpretCrmChat("Sofia Mamani Quispe en realidad se llama Sofía Mamani", {
    ...ctx,
    leads: withCrm,
  });
  assert.equal(turn.kind, "confirm");
  if (turn.kind !== "confirm") return;
  assert.equal(turn.reply, "Nombre de «Sofia Mamani Quispe» a «Sofía Mamani». ¿Confirmo?");
  assert.equal(turn.proposal.changes[0]?.from, "Sofia Mamani Quispe");
  assert.equal(turn.proposal.changes[0]?.to, "Sofía Mamani");

  const accent = interpretCrmChat("Sofia Mamani en realidad se llama Sofía Mamani", {
    ...ctx,
    leads: ctx.leads.map((lead) =>
      lead.id === "sofia" ? { ...lead, name: "Sofia Mamani", crmName: "Sofia Mamani" } : lead,
    ),
  });
  assert.equal(accent.kind, "confirm");
  if (accent.kind !== "confirm") return;
  assert.match(accent.reply, /Nombre de «Sofia Mamani» a «Sofía Mamani»/);
  assert.doesNotMatch(accent.reply, /ya está guardado/);

  const same = interpretCrmChat("Sofía Mamani en realidad se llama Sofía Mamani", ctx);
  assert.equal(same.kind, "answer");
  if (same.kind !== "answer") return;
  assert.match(same.reply, /ya está guardado/);
});

test("sí renames the CRM name even when the lead record already matches", async () => {
  const { prisma, calls } = fakeCrm();
  const result = await applyChatProposal(prisma, "user-1", {
    leadId: "sofia",
    leadName: "Sofia Mamani Quispe",
    changes: [
      { field: "name", label: "Nombre", from: "Sofia Mamani Quispe", to: "Sofía Mamani" },
    ],
  });
  assert.match(result.reply, /Listo/);
  assert.equal(calls.some((call) => call.startsWith("lead:")), false);
  assert.equal(calls.includes("updateMany"), false);
  assert.ok(calls.includes("findMany"));
  assert.ok(calls.some((call) => call === "callname:Sofía Mamani"));
});

test("inicio chat proposes the shown CRM name and sí writes it", async () => {
  const state = {
    id: "call-1",
    leadName: "",
    title: "Sofia Mamani Quispe",
    summary: "",
    source: "",
    sourceId: "",
    filingJson: { cliente_real: "Sofia Mamani Quispe" } as { cliente_real: string },
  };
  const prefs: Record<string, unknown> = {};
  const writes: string[] = [];
  const prisma = {
    user: {
      findUnique: async () => ({ crmPrefs: { ...prefs } }),
    },
    userOffer: { findMany: async () => [] },
    lead: {
      findMany: async () => [
        {
          id: "sofia",
          name: "Sofía Mamani",
          offerName: "",
          nextStep: "",
          lastSummary: "",
          amountPaid: "",
        },
      ],
      findFirst: async () => ({ id: "sofia", name: "Sofía Mamani", offerName: "" }),
      update: async ({ data }: { data: { name?: string } }) => {
        writes.push(`lead:${data.name || ""}`);
      },
    },
    callRecord: {
      findMany: async () => [{ ...state }],
      findFirst: async () => ({ ...state }),
      update: async ({
        data,
      }: {
        data: { leadName?: string; title?: string; filingJson?: { cliente_real?: string } };
      }) => {
        writes.push("call");
        if (data.leadName) state.leadName = data.leadName;
        if (data.title) state.title = data.title;
        if (data.filingJson?.cliente_real) state.filingJson.cliente_real = data.filingJson.cliente_real;
      },
      updateMany: async () => {
        writes.push("updateMany");
        throw new Error("Transactions are not supported");
      },
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(" ");
      if (sql.includes(" - ")) delete prefs.pendingChat;
      else if (sql.includes("jsonb_set")) {
        const json = values.find((value) => typeof value === "string" && value.trim().startsWith("{"));
        if (typeof json === "string") prefs.pendingChat = JSON.parse(json);
      }
      return 1;
    },
  };
  const first = await answerCrmChat(
    prisma as unknown as PrismaClient,
    "user-1",
    "Sofia Mamani Quispe en realidad se llama Sofía Mamani",
  );
  assert.equal(first, "Nombre de «Sofia Mamani Quispe» a «Sofía Mamani». ¿Confirmo?");
  assert.equal(writes.includes("updateMany"), false);
  assert.equal(writes.some((item) => item.startsWith("lead:")), false);
  assert.equal(state.filingJson.cliente_real, "Sofia Mamani Quispe");

  const second = await answerCrmChat(prisma as unknown as PrismaClient, "user-1", "sí");
  assert.match(second || "", /Listo/);
  assert.equal(state.leadName, "Sofía Mamani");
  assert.equal(state.title, "Sofía Mamani");
  assert.equal(state.filingJson.cliente_real, "Sofía Mamani");
  assert.equal(writes.includes("updateMany"), false);
  assert.equal(writes.some((item) => item.startsWith("lead:")), false);
});

test("a cuota payment for a named lead confirms Cobrado", () => {
  const turn = interpretCrmChat("Valeria Ríos pagó la primera cuota de 533", {
    ...ctx,
    leads: [
      ...leads,
      {
        id: "valeria",
        name: "Valeria Ríos",
        offerName: "Fertilidad Consciente",
        nextStep: "",
        lastSummary: "",
        amountPaid: "",
      },
    ],
  });
  assert.equal(turn.kind, "confirm");
  if (turn.kind !== "confirm") return;
  assert.equal(turn.proposal.leadId, "valeria");
  assert.equal(turn.proposal.changes[0]?.field, "cash");
  assert.equal(turn.proposal.changes[0]?.label, "Cobrado");
  assert.equal(turn.proposal.changes[0]?.from, "0");
  assert.equal(turn.proposal.changes[0]?.to, "533");
  assert.match(turn.reply, /1ª cuota/);
  assert.match(turn.reply, /¿Confirmo\?/);
});

test("a cuota adds to the Cobrado the CRM already shows and does not apply twice", async () => {
  const valeria = {
    id: "valeria",
    name: "Valeria Ríos",
    offerName: "Fertilidad Consciente",
    nextStep: "",
    lastSummary: "",
    amountPaid: "533",
  };
  const sentence = "Valeria Ríos pagó la primera cuota de 533";
  const turn = interpretCrmChat(sentence, { ...ctx, leads: [...leads, valeria] });
  assert.equal(turn.kind, "confirm");
  if (turn.kind !== "confirm") return;
  assert.equal(turn.proposal.changes[0]?.from, "533");
  assert.equal(turn.proposal.changes[0]?.to, "1066");
  assert.match(turn.reply, /Cobrado de Valeria Ríos de 533 a 1\.066 \(2ª cuota\)/);
  assert.ok(turn.proposal.applyKey);

  const repeat = interpretCrmChat(sentence, {
    ...ctx,
    leads: [...leads, { ...valeria, amountPaid: "1066" }],
    appliedCash: { leadId: "valeria", key: turn.proposal.applyKey || "", to: "1066" },
  });
  assert.equal(repeat.kind, "answer");
  if (repeat.kind !== "answer") return;
  assert.match(repeat.reply, /sigue en 1\.066/);
  assert.match(repeat.reply, /No lo sumé otra vez/);

  let paid = "533";
  let cash = 533;
  const prisma = {
    lead: {
      findFirst: async () => ({ id: "valeria", name: "Valeria Ríos", amountPaid: paid }),
      update: async ({ data }: { data: { amountPaid?: string } }) => {
        if (data.amountPaid != null) paid = data.amountPaid;
      },
    },
    callRecord: {
      findFirst: async () => ({
        id: "call-valeria",
        leadName: "Valeria Ríos",
        cashCollected: cash,
        filingJson: { cash_collected: cash },
      }),
      findMany: async () => [],
      update: async ({ data }: { data: { cashCollected?: number } }) => {
        if (data.cashCollected != null) cash = data.cashCollected;
      },
      updateMany: async () => {
        throw new Error("updateMany");
      },
    },
  };
  const first = await applyChatProposal(prisma as unknown as PrismaClient, "user-1", turn.proposal);
  assert.match(first.reply, /Listo/);
  assert.equal(paid, "1066");
  assert.equal(cash, 1066);
  const second = await applyChatProposal(prisma as unknown as PrismaClient, "user-1", turn.proposal);
  assert.match(second.reply, /ya está en 1\.066/);
  assert.match(second.reply, /No lo sumé otra vez/);
  assert.equal(paid, "1066");
  assert.equal(cash, 1066);
});

test("chat Cobrado comes from the call when the lead field is empty", () => {
  const shown = cobradoFromCalls("Valeria Ríos", [
    {
      leadName: "Valeria Ríos",
      cashCollected: 533,
      filingJson: { cash_collected: 533 },
    },
  ]);
  assert.equal(shown, 533);
  const turn = interpretCrmChat("Valeria Ríos pagó la cuota de 533", {
    ...ctx,
    leads: [
      {
        id: "valeria",
        name: "Valeria Ríos",
        offerName: "Fertilidad Consciente",
        nextStep: "",
        lastSummary: "",
        amountPaid: String(shown),
      },
    ],
  });
  assert.equal(turn.kind, "confirm");
  if (turn.kind !== "confirm") return;
  assert.equal(turn.proposal.changes[0]?.from, "533");
  assert.equal(turn.proposal.changes[0]?.to, "1066");
  assert.doesNotMatch(turn.reply, /«—»/);
});

test("pending today is a summary and who to call is a ranked list", () => {
  assert.equal(asksForPendingDesk("¿Qué tengo pendiente hoy?"), true);
  assert.equal(asksForPendingDesk("¿qué tengo hoy?"), true);
  assert.equal(asksForPendingDesk("pendientes"), true);
  assert.equal(asksForPendingDesk("¿a quién llamo hoy?"), true);
  assert.equal(asksForPendingDesk("No tengo ningún cambio pendiente. ¿Qué quieres actualizar?"), false);
  assert.equal(deskQuestionKind("¿Qué tengo pendiente hoy?"), "summary");
  assert.equal(deskQuestionKind("¿a quién llamo hoy?"), "calls");
  assert.equal(deskQuestionKind("¿a quién escribo hoy?"), "calls");
  const desk = [
    {
      name: "Valeria Ríos",
      step: "Cobro de la siguiente cuota",
      date: "2026-10-09",
      estado: "HOY" as const,
      amount: 533,
      lateDays: 0,
      kind: "cobro" as const,
      reason: "cuota de 533 vence hoy",
    },
    {
      name: "Carlos Ramírez",
      step: "Decisión",
      date: "2026-09-20",
      estado: "VENCIDO" as const,
      amount: 0,
      lateDays: 19,
      kind: "llamada" as const,
      reason: "prometió decidir el viernes",
    },
  ];
  const summary = interpretCrmChat("¿Qué tengo pendiente hoy?", { ...ctx, desk, unclassified: 8 });
  const calls = interpretCrmChat("¿a quién llamo hoy?", { ...ctx, desk, unclassified: 8 });
  assert.equal(summary.kind, "answer");
  assert.equal(calls.kind, "answer");
  if (summary.kind !== "answer" || calls.kind !== "answer") return;
  assert.match(summary.reply, /1 seguimiento vencido/);
  assert.match(summary.reply, /1 para hoy/);
  assert.match(summary.reply, /1 cobro/);
  assert.match(summary.reply, /8 llamadas por clasificar/);
  assert.match(summary.reply, /Valeria Ríos \(Cuota de 533 vence hoy\)/);
  assert.match(calls.reply, /Llama hoy, en este orden/);
  assert.match(calls.reply, /más dinero primero/);
  assert.match(calls.reply, /1\. Valeria Ríos\. Cuota de 533 vence hoy\./);
  assert.doesNotMatch(calls.reply, /\.\./);
  assert.match(calls.reply, /Prometió decidir el viernes/);
  assert.doesNotMatch(calls.reply, /por clasificar/);
  assert.notEqual(summary.reply, calls.reply);
  assert.doesNotMatch(summary.reply, /Pega todo junto/);
  assert.doesNotMatch(calls.reply, /Pega todo junto/);
});

const moneyBrief = {
  month: { cobrado: 1066, vendido: 1597 },
  week: { cobrado: 200, vendido: 400 },
  today: { cobrado: 0, vendido: 0 },
  saldoPorCobrar: 531,
  dineroEnJuego: 63600,
};

test("money questions use Resumen numbers and never the offer paste", () => {
  assert.equal(asksForMoneyStats("¿Cuánto llevo cobrado este mes?"), true);
  assert.equal(asksForMoneyStats("¿cuánto vendí?"), true);
  assert.equal(asksForMoneyStats("¿cuánto cobré esta semana?"), true);
  assert.equal(asksForMoneyStats("¿cuánto cobré hoy?"), true);
  assert.equal(asksForMoneyStats("saldo por cobrar"), true);
  assert.equal(asksForMoneyStats("dinero en juego"), true);
  assert.equal(asksForMoneyStats("esta semana"), true);
  assert.equal(asksForMoneyStats("hoy"), true);
  assert.equal(asksForMoneyStats("este mes"), true);
  assert.equal(asksForMoneyStats("¿qué tengo hoy?"), false);
  assert.equal(asksForMoneyStats("Valeria Ríos pagó la cuota de 533"), false);
  assert.equal(bareMoneyPeriod("esta semana"), "week");

  const month = formatMoneyStats("¿Cuánto llevo cobrado este mes?", moneyBrief);
  assert.match(month, /Este mes llevas cobrado USD 1\.066/);
  assert.match(month, /Saldo por cobrar USD 531/);
  assert.match(month, /Dinero en juego USD 63\.600/);
  assert.doesNotMatch(month, /Esta semana/);
  assert.doesNotMatch(month, /Pega todo junto/);

  const sold = formatMoneyStats("¿cuánto vendí?", moneyBrief);
  assert.match(sold, /Este mes vendiste USD 1\.597/);
  assert.match(sold, /Esta semana vendiste USD 400/);
  assert.match(sold, /Hoy vendiste USD 0/);
  assert.match(sold, /Saldo por cobrar USD 531/);
  assert.doesNotMatch(sold, /Pega todo junto/);

  const week = formatMoneyStats("¿cuánto cobré esta semana?", moneyBrief);
  assert.match(week, /Esta semana llevas cobrado USD 200/);
  assert.doesNotMatch(week, /Este mes/);

  const today = formatMoneyStats("¿cuánto cobré hoy?", moneyBrief);
  assert.match(today, /Hoy llevas cobrado USD 0/);
  assert.match(today, /Dinero en juego USD 63\.600/);

  assert.match(formatMoneyStats("saldo por cobrar", moneyBrief), /^Saldo por cobrar USD 531/);
  assert.match(formatMoneyStats("dinero en juego", moneyBrief), /Dinero en juego USD 63\.600/);

  const weekOnly = formatMoneyStats("esta semana", moneyBrief);
  assert.match(weekOnly, /Esta semana llevas cobrado USD 200/);
  assert.match(weekOnly, /Esta semana vendiste USD 400/);
  assert.doesNotMatch(weekOnly, /Este mes/);
  assert.doesNotMatch(weekOnly, /Pega todo junto/);
  const todayOnly = formatMoneyStats("hoy", moneyBrief);
  assert.match(todayOnly, /Hoy llevas cobrado USD 0/);
  assert.match(todayOnly, /Hoy vendiste USD 0/);
});

test("an unknown question lists what the chat can do; an offer paste does not", () => {
  const help = chatCapabilitiesReply();
  assert.match(help, /cobrado/);
  assert.match(help, /saldo por cobrar/);
  assert.match(help, /dinero en juego/);
  assert.doesNotMatch(help, /Pega todo junto/);
  assert.equal(looksLikeOfferSetup("¿qué hora es en Lima?"), false);
  assert.equal(looksLikeOfferSetup("¿Cuánto llevo cobrado este mes?"), false);
  assert.equal(
    looksLikeOfferSetup("Vendo Mentoría Prueba QA a USD 900 contado o 3 cuotas de 330."),
    true,
  );
  assert.equal(
    looksLikeFilingAnswer("Vendo Mentoría Prueba QA a USD 900 contado o 3 cuotas de 330."),
    false,
  );
  assert.equal(asksForMoneyStats("Vendo Mentoría Prueba QA a USD 900 contado o 3 cuotas de 330."), false);
  assert.equal(
    looksLikeOfferSetup(
      "La oferta se llama Círculo Millonario. Precio de lista USD 11800, contado especial USD 10000 en 3 cuotas. Comisión 10% cuando el cliente paga, por transferencia a la cuenta de la empresa.",
    ),
    true,
  );
  assert.equal(
    missingOfferSetupPhrase(["cómo te pagan comisión (plazo, forma de pago, %)"]),
    "falta cómo te pagan comisión",
  );
  assert.equal(
    missingOfferSetupPhrase(["precio de lista", "modos de pago"]),
    "falta precio y pagos",
  );
});

test("a bare no is not a filing answer", () => {
  assert.equal(looksLikeFilingAnswer("no"), false);
  assert.equal(looksLikeFilingAnswer("cancela"), false);
});

function coldDeskPrisma(failTimes: number) {
  let tries = 0;
  return {
    user: {
      findUnique: async () => {
        tries += 1;
        if (tries <= failTimes) throw new Error("cold neon timeout");
        return { crmPrefs: null };
      },
    },
    lead: { findMany: async () => [] },
    callRecord: { findMany: async () => [] },
    userOffer: { findMany: async () => [] },
    followupThread: { findMany: async () => [] },
    leadAlert: { findMany: async () => [] },
    waves: () => tries,
  };
}

test("a cold failed pending read retries once and never pastes the offer", async () => {
  const db = coldDeskPrisma(1);
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    const reply = await answerCrmChat(
      db as unknown as PrismaClient,
      "user-1",
      "¿Qué tengo pendiente hoy?",
    );
    assert.match(reply || "", /0 para hoy/);
    assert.match(reply || "", /sin cobros pendientes/);
    assert.doesNotMatch(reply || "", /Pega todo junto/);
    assert.equal(db.waves(), 2);
    assert.ok(errors.some((row) => JSON.stringify(row).includes("crm chat read")));
  } finally {
    console.error = orig;
  }
});

test("a cold read that fails twice answers in Spanish", async () => {
  const db = coldDeskPrisma(5);
  const orig = console.error;
  console.error = () => undefined;
  try {
    const reply = await answerCrmChat(
      db as unknown as PrismaClient,
      "user-1",
      "¿Qué tengo pendiente hoy?",
    );
    assert.equal(reply, crmReadFailureReply());
    assert.match(reply || "", /No pude leer tus datos del CRM/);
    assert.doesNotMatch(reply || "", /Pega todo junto/);
    assert.equal(db.waves(), 2);
  } finally {
    console.error = orig;
  }
});

test("an empty cold read still answers the desk", async () => {
  const db = coldDeskPrisma(0);
  const reply = await answerCrmChat(
    db as unknown as PrismaClient,
    "user-1",
    "¿Qué tengo pendiente hoy?",
  );
  assert.match(reply || "", /Hoy tienes 0 para hoy/);
  assert.match(reply || "", /sin cobros pendientes/);
  assert.doesNotMatch(reply || "", /Pega todo junto/);
  assert.equal(recognizedCrmQuestion("¿Qué tengo pendiente hoy?"), true);
  assert.equal(db.waves(), 1);
});

test("who to call uses the filing objection and leaves an empty row generic", async () => {
  const prisma = {
    user: { findUnique: async () => ({ crmPrefs: null }) },
    lead: { findMany: async () => [] },
    userOffer: { findMany: async () => [] },
    callRecord: {
      findMany: async () => [
        {
          leadName: "Ana Quispe",
          offerName: "Círculo Millonario",
          title: "Ana",
          summary: "esto es un resumen que no debe salir",
          filingJson: {
            cliente_real: "Ana Quispe",
            tipo_seguimiento: "SEGUIMIENTO",
            proximo_seguimiento: "2026-09-01",
            acuerdo_seguimiento: "",
            razon_no_cierre: "Precio / No tiene dinero",
          },
          source: "fathom",
          sourceId: "a",
          cashCollected: null,
          recordedAt: new Date("2026-08-01T15:00:00.000Z"),
        },
        {
          leadName: "Otto Nulo",
          offerName: "",
          title: "Otto",
          summary: "tampoco este resumen",
          filingJson: {
            cliente_real: "Otto Nulo",
            tipo_seguimiento: "SEGUIMIENTO",
            proximo_seguimiento: "2026-09-02",
            acuerdo_seguimiento: "",
          },
          source: "fathom",
          sourceId: "b",
          cashCollected: null,
          recordedAt: new Date("2026-08-02T15:00:00.000Z"),
        },
      ],
    },
  };
  const reply = await answerCrmChat(
    prisma as unknown as PrismaClient,
    "user-1",
    "¿a quién llamo hoy?",
  );
  assert.match(reply || "", /resolver la objeción de precio/);
  assert.match(reply || "", /retomar el contacto/);
  assert.doesNotMatch(reply || "", /resumen/);
  assert.doesNotMatch(reply || "", /Pega todo junto/);
});

test("the hub paste cannot run for a recognized CRM question", () => {
  const route = readFileSync(new URL("../app/api/hub/route.ts", import.meta.url), "utf8");
  const chat = readFileSync(new URL("./hub-crm-chat.ts", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../components/home-screen.tsx", import.meta.url), "utf8");
  const hubChat = readFileSync(new URL("../components/hub-chat.tsx", import.meta.url), "utf8");
  const guard = route.indexOf("recognizedCrmQuestion(userText)");
  const paste = route.lastIndexOf("OFFER_PASTE_TEXT");
  assert.ok(guard > 0 && paste > guard);
  assert.equal(route.includes("loadLiveGuides"), false);
  assert.match(route, /returned-offer-paste/);
  assert.match(route, /status: 503/);
  assert.doesNotMatch(route, /phase: "a"/);
  assert.match(chat, /Pega todo junto/);
  assert.match(screen, /offersUnreadable/);
  assert.match(hubChat, /chatSendReady/);
  const pending = "¿Qué tengo pendiente hoy?";
  assert.equal(recognizedCrmQuestion(pending), true);
  assert.deepEqual(
    offerPasteReplyAllowed({ text: pending, offersUnreadable: true, missingCrm: true }),
    { allow: false, reason: "offers-unreadable" },
  );
  assert.equal(
    offerPasteReplyAllowed({ text: pending, offersUnreadable: false, missingCrm: true }).allow,
    false,
  );
  assert.equal(
    offerPasteReplyAllowed({ text: "¿y el precio?", offersUnreadable: false, missingCrm: true }).reason,
    "question",
  );
  assert.equal(
    offerPasteReplyAllowed({
      text: "te mando la oferta luego",
      offersUnreadable: false,
      missingCrm: true,
    }).allow,
    true,
  );
  assert.equal(guardCoachReply(pending, OFFER_PASTE_TEXT, true).includes("Pega todo junto"), false);
  assert.equal(guardCoachReply(pending, OFFER_PASTE_TEXT, false).includes("Pega todo junto"), false);
  assert.match(guardCoachReply(pending, OFFER_PASTE_TEXT), /No pude leer tus datos del CRM/);
  assert.equal(
    guardCoachReply("te mando la oferta luego", OFFER_PASTE_TEXT, true),
    OFFER_PASTE_TEXT,
  );
});

test("an offers read that fails or comes back empty after an error is not no-offer", async () => {
  const orig = console.error;
  console.error = () => undefined;
  try {
    let calls = 0;
    const recovered = await retryRead(
      "home offers",
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("cold");
        return [{ productName: "Círculo Millonario" }];
      },
      (rows) => rows.length === 0,
    );
    assert.equal(recovered[0]?.productName, "Círculo Millonario");
    assert.equal(calls, 2);

    calls = 0;
    await assert.rejects(() =>
      retryRead(
        "home offers",
        async () => {
          calls += 1;
          if (calls === 1) throw new Error("cold");
          return [];
        },
        (rows) => rows.length === 0,
      ),
    );

    calls = 0;
    await assert.rejects(() =>
      retryRead(
        "home offers",
        async () => {
          calls += 1;
          if (calls === 1) return [];
          throw new Error("recheck");
        },
        (rows) => rows.length === 0,
      ),
    );

    const empty = await retryRead(
      "home offers",
      async () => [] as { productName: string }[],
      (rows) => rows.length === 0,
    );
    assert.deepEqual(empty, []);
  } finally {
    console.error = orig;
  }
});

test("a cold offers failure does not open onboarding or the paste", async () => {
  const orig = console.error;
  console.error = () => undefined;
  let reads = 0;
  const prisma = {
    userOffer: {
      findMany: async () => {
        reads += 1;
        if (reads === 1) return [];
        throw new Error("cold offers");
      },
    },
    fathomConnection: { findUnique: async () => ({ webhookId: "w" }) },
    fathomRecording: { count: async () => 2 },
    $queryRaw: async () => [],
    clientTranscript: { count: async () => 0 },
    callRecord: { count: async () => 4 },
  };
  try {
    const home = await getHomeState(prisma as unknown as PrismaClient, "user-1");
    assert.equal(home.offersUnreadable, true);
    assert.equal(home.missingCrm, null);
    assert.equal(home.hasOffer, true);
    assert.notEqual(home.phase, "a");
    const pending = "¿Qué tengo pendiente hoy?";
    const decision = offerPasteReplyAllowed({
      text: pending,
      offersUnreadable: home.offersUnreadable,
      missingCrm: Boolean(home.missingCrm),
    });
    assert.equal(decision.allow, false);
    assert.equal(guardCoachReply(pending, OFFER_PASTE_TEXT, decision.allow).includes("Pega todo junto"), false);
  } finally {
    console.error = orig;
  }
});
