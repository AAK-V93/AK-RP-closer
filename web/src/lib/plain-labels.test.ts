import assert from "node:assert/strict";
import { test } from "node:test";
import { countPhrase, labelCrmProse, personLikeTitle, plainStatus, porConfirmarLabel, presentChatState, questionWithStoredName, readableTitle, spanishAgendaInText } from "./plain-labels";

test("screen labels hide internal status codes", () => {
  assert.equal(plainStatus("CIERRE VENTA"), "Cerró");
  assert.equal(plainStatus("DECISION"), "Decisión");
  assert.equal(plainStatus("RETOMAR"), "Retomar");
  assert.equal(plainStatus("PAGO PENDIENTE"), "Pago pendiente");
  assert.equal(plainStatus("SEGUNDA REUNION"), "Segunda reunión");
  assert.equal(plainStatus("SÍ"), "Sí");
  assert.equal(plainStatus("PENDIENTE"), "Por cobrar");
  assert.equal(plainStatus("SEGUNDA_REUNION"), "Segunda reunión");
  assert.equal(plainStatus("SEGUIMIENTO"), "Seguimiento");
  assert.equal(plainStatus("POST_COBRANZA"), "Después del cobro");
  assert.equal(plainStatus("ALGO_NUEVO"), "Algo Nuevo");
  assert.equal(plainStatus(""), "—");
  assert.equal(plainStatus("SHOW"), "Asistió");
  assert.equal(plainStatus("NO SHOW"), "No asistió");
  assert.equal(plainStatus("PAGO PENDIENTE"), "Pago pendiente");
  assert.equal(plainStatus("RETOMAR"), "Retomar");
  assert.equal(plainStatus("MEET"), "Meet");
  assert.equal(plainStatus("ZOOM"), "Zoom");
  assert.equal(plainStatus("OTROS"), "Otros");
  assert.equal(plainStatus("SI"), "Sí");
  assert.equal(plainStatus("INTERNA"), "Interna");
  assert.equal(plainStatus("NO_COMERCIAL"), "No comercial");
  assert.equal(plainStatus("cerro"), "Cerró");
  assert.equal(plainStatus("CASH"), "Contado");
  assert.equal(plainStatus("seguimiento"), "Seguimiento");
  assert.equal(plainStatus("perdido"), "Perdido");
});

test("notes say Asistió instead of SHOW", () => {
  assert.equal(
    spanishAgendaInText("SHOW. No cerró. Se acordó segunda reunión."),
    "Asistió. No cerró. Se acordó segunda reunión.",
  );
  assert.equal(spanishAgendaInText("NO SHOW. No contestó."), "No asistió. No contestó.");
  assert.equal(spanishAgendaInText("SHOWROOM"), "SHOWROOM");
});

test("chat state uses the Spanish stage labels", () => {
  assert.equal(
    labelCrmProse("Sofia · Círculo Millonario · SHOW · CIERRE VENTA"),
    "Sofia · Círculo Millonario · Asistió · Cerró venta",
  );
  assert.equal(labelCrmProse("NO SHOW en la segunda"), "No asistió en la segunda");
  assert.equal(
    labelCrmProse("No tengo ningún cambio pendiente. ¿Qué quieres actualizar?"),
    "No tengo ningún cambio pendiente. ¿Qué quieres actualizar?",
  );
  assert.equal(labelCrmProse("PENDIENTE"), "Por cobrar");
  const state = presentChatState({
    leads: [{ name: "Diego", status: "seguimiento", next: "DECISION" }],
    appliedCalls: ["Diego · SHOW"],
    alertsDue: [{ tipo: "CIERRE VENTA", question: "¿SHOW o NO SHOW?" }],
  }) as {
    leads: { status: string; next: string }[];
    appliedCalls: string[];
    alertsDue: { tipo: string; question: string }[];
  };
  assert.equal(state.leads[0]?.status, "Seguimiento");
  assert.equal(state.leads[0]?.next, "Decisión");
  assert.equal(state.appliedCalls[0], "Diego · Asistió");
  assert.equal(state.alertsDue[0]?.tipo, "Cerró venta");
  assert.equal(state.alertsDue[0]?.question, "¿Asistió o No asistió?");
});

test("counts use singular and plural", () => {
  assert.equal(countPhrase(1, "llamada real", "llamadas reales"), "1 llamada real");
  assert.equal(countPhrase(4, "llamada real", "llamadas reales"), "4 llamadas reales");
  assert.equal(countPhrase(0, "seguimiento", "seguimientos"), "0 seguimientos");
  assert.equal(porConfirmarLabel(1), "Tienes 1 llamada por confirmar");
  assert.equal(porConfirmarLabel(9), "Tienes 9 llamadas por confirmar");
  assert.equal(readableTitle("KATHERINE REINOSO SARMIENTO"), "Katherine Reinoso Sarmiento");
  assert.equal(readableTitle("Llamada del 2 oct"), "Llamada del 2 oct");
  const bogota = new Date("2026-10-05T15:00:00Z");
  assert.equal(readableTitle("Carlos Ramírez · 30/9/2026", bogota), "Carlos Ramírez · 30 sep");
  assert.equal(readableTitle("Valeria Ríos · 29/9/2025", bogota), "Valeria Ríos · 29 sep 2025");
  assert.equal(
    questionWithStoredName(
      "¿Qué seguimiento quedó con Katherine Rodríguez? (segunda reunión, pago, decisión, retomar)",
      "Katerine Rodríguez",
      "Katherine Rodríguez",
    ),
    "¿Qué seguimiento quedó con Katerine Rodríguez? (segunda reunión, pago, decisión, retomar)",
  );
  assert.equal(questionWithStoredName("¿Con quién hablaste?", "Katerine", "Katherine"), "¿Con quién hablaste?");
  assert.equal(personLikeTitle("Katerine Rodríguez"), "Katerine Rodríguez");
  assert.equal(personLikeTitle("Carlos Ramírez · 30/9/2026"), "");
});
