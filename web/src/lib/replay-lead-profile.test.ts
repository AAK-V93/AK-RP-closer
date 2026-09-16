import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReplayCall } from "./replay-call";
import { emptyPlaybook } from "./lead-playbook";
import {
  buildReplayLeadProfile,
  replayCharacterInstructions,
} from "./replay-lead-profile";
import { filingFromCall } from "./replay-call";
import { buildProspectInstructions, generateProspectProfile } from "./prospect-prompt";
import { defaultTrainingSession } from "../data/training-session";

function replay(overrides: Partial<ReplayCall> = {}): ReplayCall {
  return {
    source: "upload",
    sourceId: "c1",
    title: "Llamada con Carla",
    leadName: "Carla Ríos",
    offerName: "Mentoría",
    result: "no_cerro",
    callType: "cierre",
    objections: "",
    summary: "",
    leadLines: [
      "Mira, el negocio está trabado y no me alcanza el tiempo",
      "Lo tengo que hablar con mi socio",
      "Está caro para lo que facturo ahora",
      "Sí, ok",
    ],
    excerpt:
      "Closer: cuéntame de ti. Carla: Tengo un negocio de consultoría. El problema es que no me alcanza el tiempo. Lo tengo que hablar con mi socio. Está caro para lo que facturo ahora.",
    filing: null,
    ...overrides,
  };
}

test("replay profile uses filing reason and amounts, not transcript as script", () => {
  const profile = buildReplayLeadProfile({
    replay: replay({
      filing: {
        notasCrm: "Dueña de consultoría, quiere ordenar ventas",
        razonNoCierre: "precio vs cash del mes",
        etapaPerdida: "cierre",
        ventaTotal: 4800,
        cashCollected: 0,
        saldoPendiente: 4800,
        modoPago: "contado",
        producto: "Mentoría",
      },
    }),
    playbook: {
      ...emptyPlaybook(),
      icp: "Dueños de servicios que venden sin proceso",
      typicalObjections: [
        { quote: "está caro", root: "caja del mes" },
        { quote: "lo hablo con mi socio", root: "no decide solo" },
      ],
      howLeadsTalk: "Hablan del día a día del negocio, no de funnels",
    },
  });

  assert.equal(profile.name, "Carla Ríos");
  assert.equal(profile.isRealLead, true);
  assert.equal(profile.heldObjection, "precio vs cash del mes");
  assert.match(profile.moneySituation, /4800/);
  assert.match(profile.partnerSituation.toLowerCase(), /socio/);
  assert.ok(!profile.objections.some((item) => /^sí, ok$/i.test(item)));
  assert.ok(!profile.objections.includes("Mira, el negocio está trabado y no me alcanza el tiempo"));
  assert.match(profile.personalityNotes, /ritmo, no un guion/i);
});

test("replay instructions tell the model to improvise off-profile, not recite lines", () => {
  const call = replay({
    filing: {
      notasCrm: "Quiere ordenar el equipo comercial",
      razonNoCierre: "lo habla con el socio",
      etapaPerdida: "",
      ventaTotal: null,
      cashCollected: null,
      saldoPendiente: null,
      modoPago: "",
      producto: "",
    },
  });
  const profile = generateProspectProfile(
    "Mentoría",
    "Cierre high-ticket",
    "medium",
    "es",
    null,
    "",
    call,
  );
  const text = replayCharacterInstructions(profile, call, {
    ...emptyPlaybook(),
    icp: "Dueños de agencias",
    typicalObjections: [{ quote: "está caro", root: "caja" }],
  });

  assert.match(text, /Eres esta persona/);
  assert.match(text, /no está en la llamada original/);
  assert.match(text, /ANTI-LOOP/);
  assert.match(text, /Nunca repitas una respuesta ya dada/);
  assert.doesNotMatch(text, /Verbatim flavor/);
  assert.doesNotMatch(text, /Copy their rhythm and the lines they actually used/);
  assert.ok(!text.includes(call.excerpt.slice(0, 80)));

  const instructions = buildProspectInstructions({
    ...defaultTrainingSession,
    productName: "Mentoría",
    productDescription: "Cierre",
    practiceKind: "replay",
    replayCall: call,
    prospectProfile: profile,
  });
  assert.match(instructions, /ANTI-LOOP/);
  assert.doesNotMatch(instructions, /Excerpt:/);
  assert.ok(!instructions.includes(call.excerpt.slice(0, 60)));
});

test("filingFromCall reads extractor CRM fields", () => {
  const filing = filingFromCall({
    filingJson: {
      notas_crm: "No cierra por caja",
      razon_no_cierre: "precio",
      venta_total: 12000,
      modo_pago: "3 cuotas",
    },
    summary: "ignored when notas exist",
    ventaTotal: 1,
  });
  assert.equal(filing?.notasCrm, "No cierra por caja");
  assert.equal(filing?.razonNoCierre, "precio");
  assert.equal(filing?.ventaTotal, 12000);
  assert.equal(filing?.modoPago, "3 cuotas");
});
