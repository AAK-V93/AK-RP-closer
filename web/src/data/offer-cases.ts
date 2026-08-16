export interface OfferCase {
  id: string;
  label: string;
  tagline: string;
  productName: string;
  productDescription: string;
  pitchSummary: string;
}

export const OFFER_OTHER_ID = "other";

export const OFFER_CASES: OfferCase[] = [
  {
    id: "mentorship",
    label: "Mentoría de negocios",
    tagline: "Acompañamiento 1:1 o grupal para escalar un negocio (alto ticket).",
    productName: "Mentoría Scale 90",
    productDescription: `Programa de 90 días para dueños de negocio que facturan pero están estancados. Incluye diagnóstico, plan de oferta y adquisición, llamadas semanales de implementación y revisión de números. Ticket típico: USD 2.000–5.000. Resultado prometido: claridad de oferta, pipeline y un sistema para cerrar más sin vivir en el caos. No es un curso grabado: es acompañamiento con accountability.`,
    pitchSummary: `Mentoría Scale 90: 12 semanas, llamadas semanales, plan de oferta + adquisición, revisión de métricas. Precio de referencia USD 3.000 (o 2 cuotas). Garantía de acompañamiento extra si no hay avance de implementación.`,
  },
  {
    id: "consulting",
    label: "Consultoría",
    tagline: "Diagnóstico y plan para una empresa (B2B o profesional independiente).",
    productName: "Consultoría de operación y crecimiento",
    productDescription: `Consultoría de 8–12 semanas para negocios que ya venden pero no tienen procesos. Incluye diagnóstico, mapa de cuellos de botella, playbooks y 4 sesiones de implementación con el dueño o el equipo. Ticket típico: USD 2.500–8.000. El entregable no es “ideas”: es un plan ejecutable y seguimiento para que quede instalado.`,
    pitchSummary: `Consultoría 10 semanas: diagnóstico, playbooks, 4 sesiones de implementación. Precio de referencia USD 4.000. El cliente sale con procesos documentados y un responsable interno.`,
  },
  {
    id: "agency",
    label: "Agencia de marketing",
    tagline: "Ads, contenido o outbound a fee mensual.",
    productName: "Retainer de adquisición",
    productDescription: `Servicio mensual de adquisición (ads + creativos + seguimiento). Setup inicial y retainer de USD 1.500–4.000/mes más pauta. Pensado para negocios con oferta clara que no tienen tiempo ni equipo interno. Promesa: calendario de tests, reporting semanal y reuniones de optimización. No garantiza un número mágico de ventas; sí un sistema medible.`,
    pitchSummary: `Setup + retainer mensual. Incluye creativos, gestión de pauta y call semanal. Precio de referencia USD 2.000/mes + presupuesto de ads. Mínimo 3 meses.`,
  },
  {
    id: "course",
    label: "Curso / infoproducto",
    tagline: "Programa grabado o híbrido con comunidad.",
    productName: "Programa digital + comunidad",
    productDescription: `Programa de 8 módulos grabados más comunidad y 4 Q&A en vivo. Ticket típico: USD 297–997. Para personas que quieren un método paso a paso sin mentoría 1:1. Incluye plantillas y un plazo de acceso de 12 meses. Objeciones habituales: “ya compré cursos que no hice”, tiempo, precio vs YouTube gratis.`,
    pitchSummary: `8 módulos, comunidad, 4 lives. Precio de referencia USD 497 (o 3 cuotas). Acceso 12 meses. Enfoque en implementación, no en más teoría.`,
  },
  {
    id: "trading",
    label: "Trading",
    tagline: "Formación o mesa de trading (forex, índices, cripto). Alto escepticismo.",
    productName: "Mesa de trading 8 semanas",
    productDescription: `Programa de 8 semanas para aprender un sistema de trading con reglas, gestión de riesgo y acompañamiento en vivo. No es “señales mágicas” ni promesa de ingresos. Ticket típico: USD 1.000–3.000. El lead suele haber quemado dinero en cursos previos. El closer debe descubrir dolor (pérdidas, falta de sistema) y no vender fantasía de hacerse rico.`,
    pitchSummary: `8 semanas: sistema, riesgo, sesiones en vivo. Precio de referencia USD 1.500. Sin promesa de rentabilidad; sí un proceso y accountability. No incluye manejo de capital del cliente.`,
  },
  {
    id: "crypto",
    label: "Crypto / inversión",
    tagline: "Educación o acompañamiento para invertir; no asesoría regulada ficticia.",
    productName: "Programa de educación en cripto",
    productDescription: `Acompañamiento educativo de 60 días: fundamentos, seguridad de wallets, tesis de largo plazo y cómo no perseguir hype. Ticket típico: USD 800–2.500. El prospecto suele tener miedo a estafas, haber perdido en un ciclo anterior, o presión de “llegué tarde”. No se prometen retornos. Se vende claridad, criterio y un plan, no tips de pumps.`,
    pitchSummary: `60 días de educación + sesiones. Precio de referencia USD 1.200. Enfoque en seguridad, plan y criterio. Sin promesa de yield ni de “10x”.`,
  },
  {
    id: "health",
    label: "Salud / nutrición",
    tagline: "Programa de acompañamiento (fertilidad, peso, hábitos). Decisión en pareja a menudo.",
    productName: "Programa de nutrición funcional 90 días",
    productDescription: `Acompañamiento de 90 días en nutrición funcional (enfoque integral: hábitos, estrés, pareja si aplica). Incluye diagnóstico, plan personalizado, seguimiento y, en fertilidad, trabajo de ambos. Ticket típico: USD 1.500–2.500. El lead suele llevar años intentando solo, con médicos que “no ven nada raro”, y objeta precio o “hablarlo con mi pareja”.`,
    pitchSummary: `90 días, plan personalizado, seguimiento, enfoque de pareja si aplica. Precio de referencia USD 2.000 (opción 2 cuotas). No es una dieta genérica: es acompañamiento para la causa, no solo el síntoma.`,
  },
  {
    id: "coaching",
    label: "Coaching personal",
    tagline: "Proceso de hábitos, carrera o vida. Objeciones de “es intangible”.",
    productName: "Coaching 12 semanas",
    productDescription: `Proceso de 12 semanas (sesiones semanales) para claridad de carrera, hábitos o liderazgo personal. Ticket típico: USD 1.200–3.000. El valor es el espacio, las preguntas y el seguimiento, no un PDF. Objeciones: “puedo hacerlo solo”, pareja, tiempo, “no sé si funciona”.`,
    pitchSummary: `12 sesiones semanales. Precio de referencia USD 1.800. Incluye acuerdos de hábitos y revisión. No es terapia clínica ni un curso grabado.`,
  },
];

export function getOfferCase(id: string): OfferCase | undefined {
  return OFFER_CASES.find((c) => c.id === id);
}
