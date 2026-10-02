import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  applyChatProposal,
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
      findFirst: async () => ({ id: "call-1", filingJson: { notas_crm: "vieja" }, leadName: "Carlos Ramírez" }),
      update: async (args?: { data?: { cashCollected?: number } }) => {
        calls.push("call");
        if (args?.data && "cashCollected" in args.data) calls.push(`callcash:${args.data.cashCollected}`);
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
  assert.ok(calls.some((call) => call.startsWith("raw:") && call.includes("CallRecord")));
  const vals = calls.find((call) => call.startsWith("vals:")) || "";
  assert.match(vals, /Sofía Mamani/);
  assert.match(vals, /Sofia Mamani Quispe/);
});
