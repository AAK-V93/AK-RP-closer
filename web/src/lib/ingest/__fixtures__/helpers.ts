// Test-only helpers for the ingestion tests: a mocked model (never Gemini) and
// signed webhook headers built from a test secret (never Fathom).
import { createHmac } from "crypto";
import type { CallBrief } from "../brief";

export function briefJson(over: Partial<CallBrief> = {}): string {
  const base = {
    una_linea: "Le interesa Mentoría 90 días; lo habla con su esposo y se reúnen el viernes a las 3.",
    cliente_real: "Laura Gómez",
    estado_agenda: "SHOW",
    estado_lead: "decidiendo",
    producto: "Mentoría 90 días",
    venta_total: 2000,
    cash_collected: null,
    saldo_pendiente: null,
    moneda: "USD",
    modo_pago: null,
    decisor: { nombre: "Su esposo", rol: "pareja", presente: false, cita: "lo tengo que hablar con mi esposo", timestamp: "00:41:10" },
    promesas: [
      { lado: "cliente", que: "Reunión con su esposo", fecha: "2026-10-09T15:00", fecha_texto: "el viernes a las 3", cita: "el viernes a las 3 nos conectamos los dos", timestamp: "00:50:02", confianza: 90 },
    ],
    requiere_seguimiento: true,
    tipo_seguimiento: "reunion",
    proximo_seguimiento: "2026-10-09T15:00",
    acuerdo_seguimiento: "Reunión el viernes a las 3 con su esposo",
    notas_crm: "Quiere vender sus servicios en línea.",
    objeciones: ["Lo tiene que consultar"],
    razon_no_cierre: null,
    etapa_perdida: null,
    calificado: true,
    canal_contacto: null,
    telefono: null,
    email: null,
    evidencia: { identidad: "Laura Gómez", cierre: null, venta_total: "cuesta 2.000 dólares", cash_collected: null, modo_pago: null, seguimiento: "el viernes a las 3" },
    citas: [{ campo: "venta_total", texto: "cuesta 2.000 dólares de contado", timestamp: "00:38:02", fuente: "transcripcion" }],
    confianza: { venta_total: 90, estado_lead: 80 },
    requiere_revision_humana: false,
    motivo_revision: null,
    faltantes: [],
    aprendizajes: [
      { tipo: "BIEN", texto: "Preguntaste qué la llevó a agendar antes de presentar." },
      { tipo: "MEJORAR", texto: "Pregunta antes quién más decide, para invitarlo desde el principio." },
    ],
  };
  return JSON.stringify({ ...base, ...over });
}

/** A model that answers with `reply` and keeps every prompt it got. */
export function mockModel(reply: string | ((prompt: string) => string) | Error) {
  const prompts: string[] = [];
  const model = async (prompt: string, schema: object) => {
    prompts.push(prompt);
    if (!schema) throw new Error("schema missing");
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(prompt) : reply;
  };
  return { model, prompts };
}

export const TEST_WEBHOOK_SECRET = `whsec_${Buffer.from("closer-trainer-test-secret-32bytes!").toString("base64")}`;

export function signedHeaders(body: string, opts: { id?: string; secret?: string; at?: number } = {}) {
  const id = opts.id ?? `msg_${Math.random().toString(36).slice(2)}`;
  const at = String(opts.at ?? Math.floor(Date.now() / 1000));
  const key = Buffer.from((opts.secret ?? TEST_WEBHOOK_SECRET).replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${at}.${body}`).digest("base64");
  return new Headers({ "webhook-id": id, "webhook-timestamp": at, "webhook-signature": `v1,${sig}`, "content-type": "application/json" });
}
