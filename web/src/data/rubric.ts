export type RubricPhase = "descubrimiento" | "pitch" | "cierre";

export interface RubricCriterion {
  id: string;
  phase: RubricPhase;
  label: string;
  description: string;
  /** Critical closing technique highlighted in the rubric */
  critical?: boolean;
}

export const RUBRIC_CRITERIA: RubricCriterion[] = [
  {
    id: "p1",
    phase: "descubrimiento",
    label: "Rompe el hielo",
    description: "Inicia la llamada con calidez y reduce la tensión inicial.",
  },
  {
    id: "p2",
    phase: "descubrimiento",
    label: "Crea conexión",
    description: "Genera rapport y confianza con el prospecto.",
  },
  {
    id: "p3",
    phase: "descubrimiento",
    label: "Preguntas anti-objeciones",
    description:
      "Indaga sobre socio/pareja, tiempo y dinero para anticipar objeciones.",
  },
  {
    id: "p4",
    phase: "descubrimiento",
    label: "Comparte pantalla",
    description: "Comparte pantalla cuando corresponde en el guion.",
    critical: true,
  },
  {
    id: "p5",
    phase: "descubrimiento",
    label: "Indaga el problema",
    description:
      "Pregunta literalmente cuál es el problema y profundiza en los dolores.",
  },
  {
    id: "p6",
    phase: "descubrimiento",
    label: "Indaga historial y urgencia",
    description:
      "Explora qué ha intentado, cuánto tiempo lleva con el problema y por qué ahora.",
  },
  {
    id: "p7",
    phase: "descubrimiento",
    label: "Indaga deseo y motivación",
    description:
      "Pregunta qué quiere lograr, usa storytelling y CTA emocional; indaga dolores x3.",
  },
  {
    id: "p8",
    phase: "descubrimiento",
    label: "Micro-cierres de alineación",
    description:
      'Busca "sí" con frases como "¿Estamos alineados?", "¿Todo claro?" con tono conversacional.',
    critical: true,
  },
  {
    id: "p9",
    phase: "descubrimiento",
    label: "Cuadro METAS en Excel",
    description: "Utiliza y explica la calculadora METAS con el cliente.",
  },
  {
    id: "p10",
    phase: "descubrimiento",
    label: "Transición a la oferta",
    description: "Hace una transición natural y correcta hacia el pitch.",
  },
  {
    id: "p11",
    phase: "pitch",
    label: "Storytelling de la mentoría",
    description:
      "Explica los elementos de acción con storytelling para que el cliente se visualice dentro.",
  },
  {
    id: "p12",
    phase: "pitch",
    label: "Guía a preguntar precio",
    description: "Conduce la conversación para que el prospecto pregunte el precio.",
  },
  {
    id: "p13",
    phase: "pitch",
    label: "Oferta detallada",
    description: "Presenta la oferta de forma clara y completa.",
  },
  {
    id: "p14",
    phase: "pitch",
    label: "Dos opciones de cierre",
    description: "Muestra dos opciones con calma y busca el cierre mediante elección.",
    critical: true,
  },
  {
    id: "p15",
    phase: "pitch",
    label: "Pregunta forma de pago",
    description:
      'Pregunta "¿Cómo te gustaría pagar? Visa, Mastercard o American Express".',
    critical: true,
  },
  {
    id: "p16",
    phase: "pitch",
    label: "Silencio después del precio",
    description: "Se queda en silencio después de decir el precio.",
    critical: true,
  },
  {
    id: "p17",
    phase: "pitch",
    label: "Manejo de objeciones",
    description: "Maneja objeciones de forma óptima durante el pitch.",
  },
  {
    id: "p18",
    phase: "pitch",
    label: "Información clara",
    description: "Entrega información clara y sin ambigüedades.",
  },
  {
    id: "p19",
    phase: "pitch",
    label: "Control de la llamada",
    description: "Mantiene el control y la dirección de la conversación.",
  },
  {
    id: "p20",
    phase: "cierre",
    label: "Manejo del tiempo",
    description: "Cierra en menos de 35 minutos en la fase de cierre.",
  },
  {
    id: "p21",
    phase: "cierre",
    label: "Próxima cita",
    description: "Agenda fecha de seguimiento si no cierra en el momento.",
  },
  {
    id: "p22",
    phase: "cierre",
    label: "Intento de depósito",
    description: "Intenta o colecta depósito para asegurar la venta.",
  },
  {
    id: "p23",
    phase: "cierre",
    label: "Tonalidad y fluidez",
    description: "Mantiene buena tonalidad y fluidez conversacional.",
  },
];

export function getCriteriaForSection(section: string): RubricCriterion[] {
  switch (section) {
    case "discovery":
      return RUBRIC_CRITERIA.filter((c) => c.phase === "descubrimiento");
    case "pitch":
      return RUBRIC_CRITERIA.filter((c) => c.phase === "pitch");
    case "close":
      return RUBRIC_CRITERIA.filter((c) => c.phase === "cierre");
    case "pitch_close":
      return RUBRIC_CRITERIA.filter(
        (c) => c.phase === "pitch" || c.phase === "cierre",
      );
    case "full":
    default:
      return RUBRIC_CRITERIA;
  }
}
