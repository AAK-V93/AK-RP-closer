export interface OfferPlan {
  id: string;
  name: string;
  priceUsd: number;
  billing: string;
  summary: string;
  includes: string[];
}

export interface OfferCase {
  id: string;
  label: string;
  tagline: string;
  productName: string;
  productDescription: string;
  pitchSummary: string;
  whoItsFor: string;
  whatItIs: string;
  plans: OfferPlan[];
}

export const OFFER_OTHER_ID = "other";
export const PENDING_OFFER_STORAGE_KEY = "closer_pending_offer";

export function formatUsd(amount: number): string {
  return `USD ${amount.toLocaleString("en-US")}`;
}

export function offerAgentCopy(offer: OfferCase): string {
  const planLines = offer.plans
    .map((plan) => {
      const items = plan.includes.join("; ");
      return `- ${plan.name}: ${formatUsd(plan.priceUsd)} (${plan.billing}). ${plan.summary} Incluye: ${items}.`;
    })
    .join("\n");

  return `${offer.whatItIs}

Para quién: ${offer.whoItsFor}

Planes y precios (alto ticket; el más bajo es ${formatUsd(offer.plans[0].priceUsd)}):
${planLines}`;
}

export const OFFER_CASES: OfferCase[] = [
  {
    id: "fertility-nutrition",
    label: "Nutrición funcional para quedar en embarazo",
    tagline: "Acompañamiento de 8 a 12 semanas para concebir, con enfoque en hábitos, inflamación y pareja.",
    productName: "Programa Concebir con Nutrición Funcional",
    whoItsFor:
      "Mujeres (y su pareja, si aplica) que llevan meses o años intentando quedar embarazadas, ya pasaron por médicos que “no ven nada raro”, y quieren un plan concreto de alimentación, sueño, estrés y seguimiento — no otra dieta genérica.",
    whatItIs:
      "Acompañamiento de nutrición funcional orientado a fertilidad. No es una consulta médica ni una garantía de embarazo: es un protocolo de hábitos, un plan alimentario personalizado y accountability para que el cuerpo esté en mejor condición para concebir. Quien entra a la reunión ya vio la página o llenó un formulario: tiene contexto del producto. Qué tan calificada o lista esté para comprar depende de cada lead.",
    plans: [
      {
        id: "esencial",
        name: "Esencial",
        priceUsd: 1500,
        billing: "pago único o 2 cuotas",
        summary: "8 semanas, trabajo individual.",
        includes: [
          "Diagnóstico inicial (hábitos, historial, objetivos)",
          "Plan nutricional personalizado",
          "4 sesiones de seguimiento",
          "Ajustes del plan a mitad de proceso",
        ],
      },
      {
        id: "pareja",
        name: "Pareja",
        priceUsd: 2800,
        billing: "pago único o 3 cuotas",
        summary: "12 semanas, ambos miembros de la pareja.",
        includes: [
          "Todo lo del plan Esencial para los dos",
          "Lectura orientativa de laboratorios que ya tengan (no sustituye al médico)",
          "Protocolo de sueño, estrés y timing",
          "6 sesiones de seguimiento",
        ],
      },
      {
        id: "completo",
        name: "Completo 90 días",
        priceUsd: 4200,
        billing: "pago único o 3 cuotas",
        summary: "90 días con seguimiento cercano.",
        includes: [
          "Todo lo del plan Pareja",
          "Check-ins semanales",
          "Soporte por WhatsApp en horario acordado",
          "Revisión de hábitos de ambos y plan de mantenimiento al cerrar",
        ],
      },
    ],
    productDescription: "",
    pitchSummary: `Programa Concebir: nutrición funcional para fertilidad. Tres planes — Esencial USD 1,500 (8 semanas, individual), Pareja USD 2,800 (12 semanas, ambos), Completo 90 días USD 4,200 (semanal + WhatsApp). No promete embarazo; sí un protocolo, seguimiento y trabajo de pareja si aplica.`,
  },
  {
    id: "motivational-coaching",
    label: "Coaching motivacional",
    tagline: "Proceso 1:1 para claridad, hábitos y ejecución. No es terapia ni un curso grabado.",
    productName: "Coaching Motivacional 1:1",
    whoItsFor:
      "Personas que ya saben qué quieren (carrera, negocio, consistencia) pero se traban, posponen y salen de cada racha de motivación a las dos semanas. Buscan alguien que las sostenga con preguntas, acuerdos y seguimiento — no más contenido.",
    whatItIs:
      "Coaching motivacional 1:1 de alto ticket: sesiones, acuerdos de hábitos y accountability. El valor es el espacio y el seguimiento, no un PDF. Quien agendó ya entiende más o menos de qué se trata. El interés y la calificación (dinero, tiempo, decisor) varían según el lead.",
    plans: [
      {
        id: "impulso",
        name: "Impulso",
        priceUsd: 1500,
        billing: "pago único o 2 cuotas",
        summary: "8 semanas, una sesión por semana.",
        includes: [
          "8 sesiones 1:1 (50 min)",
          "Diagnóstico de bloqueos y metas",
          "Acuerdos de hábitos semanales",
          "Revisión al cierre",
        ],
      },
      {
        id: "transformacion",
        name: "Transformación",
        priceUsd: 2900,
        billing: "pago único o 3 cuotas",
        summary: "12 semanas con plan de ejecución.",
        includes: [
          "12 sesiones 1:1",
          "Plan de hábitos y métricas simples",
          "Check de mitad de proceso",
          "Material de trabajo entre sesiones",
        ],
      },
      {
        id: "inmersion",
        name: "Inmersión",
        priceUsd: 4800,
        billing: "pago único o 3 cuotas",
        summary: "16 semanas, acompañamiento cercano.",
        includes: [
          "16 sesiones 1:1",
          "Soporte por WhatsApp en horario acordado",
          "Revisión quincenal de metas",
          "Sesión de cierre con plan a 90 días",
        ],
      },
    ],
    productDescription: "",
    pitchSummary: `Coaching Motivacional 1:1. Tres planes — Impulso USD 1,500 (8 semanas), Transformación USD 2,900 (12 semanas), Inmersión USD 4,800 (16 semanas + WhatsApp). No es terapia clínica ni un curso: es proceso, acuerdos y seguimiento.`,
  },
  {
    id: "training-plan",
    label: "Plan de ejercicios",
    tagline: "Programación a medida y coaching de entrenamiento, no una rutina genérica de PDF.",
    productName: "Coaching de Entrenamiento a Medida",
    whoItsFor:
      "Personas que ya entrenan (o lo intentaron) y no progresan: se lesionan, copian rutinas de Instagram o abandonan a las tres semanas. Quieren un plan hecho para su cuerpo, su tiempo y un coach que las corrija.",
    whatItIs:
      "Coaching de entrenamiento de alto ticket: evaluación, programación personalizada y seguimiento. No es un PDF de 20 dólares ni un plan genérico de app. Quien agendó sabe que es un programa serio y tiene contexto de planes. Qué tan lista esté para pagar varía según el lead.",
    plans: [
      {
        id: "programa",
        name: "Programa a medida",
        priceUsd: 1500,
        billing: "pago único o 2 cuotas",
        summary: "8 semanas de programación.",
        includes: [
          "Evaluación inicial (objetivos, historial, disponibilidad)",
          "Plan de ejercicios personalizado",
          "4 ajustes del programa",
          "Guía de técnica de los movimientos clave",
        ],
      },
      {
        id: "coaching",
        name: "Coaching 12 semanas",
        priceUsd: 2600,
        billing: "pago único o 3 cuotas",
        summary: "12 semanas con check-ins semanales.",
        includes: [
          "Todo lo del Programa a medida",
          "Check-in semanal de progreso y cargas",
          "Progresión escrita semana a semana",
          "Ajustes si hay viaje, enfermedad o dolor",
        ],
      },
      {
        id: "elite",
        name: "Elite",
        priceUsd: 3900,
        billing: "pago único o 3 cuotas",
        summary: "16 semanas 1:1, seguimiento cercano.",
        includes: [
          "Todo lo del Coaching 12 semanas, extendido a 16",
          "Sesiones 1:1 de técnica",
          "Orientación básica de nutrición de rendimiento (no es dietista clínico)",
          "Soporte por WhatsApp en horario acordado",
        ],
      },
    ],
    productDescription: "",
    pitchSummary: `Coaching de Entrenamiento a Medida. Tres planes — Programa USD 1,500 (8 semanas), Coaching USD 2,600 (12 semanas con check-ins), Elite USD 3,900 (16 semanas 1:1 + WhatsApp). No es una rutina genérica: es programación y seguimiento.`,
  },
];

for (const offer of OFFER_CASES) {
  offer.productDescription = offerAgentCopy(offer);
}

export function getOfferCase(id: string): OfferCase | undefined {
  return OFFER_CASES.find((c) => c.id === id);
}
