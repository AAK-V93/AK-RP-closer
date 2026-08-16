export type RubricPhase = "descubrimiento" | "objeciones";

export interface RubricCriterion {
  id: string;
  phase: RubricPhase;
  label: string;
  description: string;
  /** Weighted more heavily in coaching feedback */
  critical?: boolean;
}

export const RUBRIC_CRITERIA: RubricCriterion[] = [
  {
    id: "pain",
    phase: "descubrimiento",
    label: "Dolor a profundidad",
    description:
      "Descubrió el dolor real del lead con preguntas curiosas, no con supuestos ni pitch. Llegó más allá de la queja superficial: impacto, historia, qué ha intentado.",
    critical: true,
  },
  {
    id: "desire",
    phase: "descubrimiento",
    label: "Deseo a profundidad",
    description:
      "Descubrió qué quiere lograr y por qué le importa, con preguntas. El lead verbalizó el resultado deseado; el closer no se lo puso en la boca.",
    critical: true,
  },
  {
    id: "urgency",
    phase: "descubrimiento",
    label: "Urgencia a profundidad",
    description:
      "Descubrió por qué ahora: costo de no actuar, timing, miedo a seguir igual. Preguntó; no empujó urgencia artificial.",
    critical: true,
  },
  {
    id: "aaa_acknowledge",
    phase: "objeciones",
    label: "AAA — Acknowledge",
    description:
      "Ante una pregunta u objeción, reformuló lo que el lead dijo, validó y compró tiempo. No discutió ni invalidó.",
  },
  {
    id: "aaa_associate",
    phase: "objeciones",
    label: "AAA — Associate",
    description:
      "Asoció la pregunta/objeción con el tipo de persona que obtiene buenos resultados (label positivo, cliente exitoso, autoridad). El lead da un paso atrás y se siente más cerca de comprar, no más lejos.",
  },
  {
    id: "aaa_ask",
    phase: "objeciones",
    label: "AAA — Ask back",
    description:
      "Preguntó sobre la pregunta. No respondió trampas de inmediato. Mantuvo el control. No cedió el volante con «¿tienes alguna pregunta?».",
    critical: true,
  },
];

/** Always the same rubric — discovery + AAA, regardless of practice section. */
export function getCriteriaForSection(_section?: string): RubricCriterion[] {
  return RUBRIC_CRITERIA;
}

/**
 * Condensed 3A (Acknowledge / Associate / Ask) coaching notes for the evaluator.
 * Source: Hormozi reframing training (3A framework + 5 rules).
 */
export const AAA_EVALUATOR_BRIEF = `
MARCO 3A (reframe después de cualquier cosa que no sea "sí"):

1) ACKNOWLEDGE — Di de vuelta lo que dijeron. Beneficios: sienten que escuchas; te compra 2–3 segundos para pensar. Nunca discutes ni invalidas. Tono: "totalmente entiendo", "es una pregunta justa", "huh, interesante".

2) ASSOCIATE — Vincula su pregunta/objeción con el comportamiento de quien mejor resultado saca de tu oferta. Si se alejan de comprar, el reframe dice: esa pregunta en realidad te hace MÁS el tipo de cliente que compra. Ejemplos:
   - "Es una gran pregunta; de hecho la hacen mucho nuestros mejores clientes."
   - "Eso muestra que estás tomando una decisión seria / racional."
   - Straw man: "hoy alguien me preguntó lo mismo, ¿te cuento lo que le dije?" / "te pareces a Sarah, que también tenía ese recelo y le fue muy bien" / "Alex me dijo esto hoy, ¿te lo comparto?"
   El straw man permite verdades duras sin insultar al prospecto.

3) ASK BACK — Pregunta sobre la pregunta. Quien pregunta controla la conversación. No contestes trampas (certificaciones, número de tickets, "tengo que pensarlo") hasta saber qué están juzgando. Ejemplos:
   - "¿Qué certificaciones buscas específicamente?" / "¿Por qué esas?"
   - "¿Para qué quieres preguntar eso? ¿Cuál es el miedo de fondo?"
   - "¿Cuál es tu preocupación principal?" / "¿De qué tienes más miedo que pase?"
   - "¿Qué haría que esto sea un no?" / "¿Qué necesitarías para decir que sí?"
   - Timing: "¿Qué lo haría un buen momento?"
   - Pareja: "¿Qué partes crees que no les gustaría?"

REGLAS:
- El prospecto casi no cree lo que TÚ dices y sí cree lo que ÉL dice. Haz que ellos concluyan el fit con preguntas, no se lo expliques.
- NUNCA preguntes "¿tienes alguna pregunta?" — les pides objeciones y les das el volante.
- Si contestas de inmediato, ellos son juez de si tu respuesta es suficiente. Pregunta primero.
- Nunca ganas una venta ganando una discusión. Sé como humo: no se te puede agarrar; no se puede estar en desacuerdo con una pregunta.
- Curiosidad infantil siempre: seek to understand, not win. Si se siente combativo, ya perdiste.
- No asumas qué preguntan: la mayoría no sabe ni ellos. Pregunta sobre su pregunta.
- "I need to think about it" / "no tengo tiempo" / "tengo que hablarlo con mi pareja" / "odio esta feature" NO son fin de la venta: acknowledge + associate + pregunta específica.
- Si no sabes la respuesta, SIEMPRE puedes preguntar más sobre su pregunta.

CÓMO SE DESCUBRE DOLOR / DESEO / URGENCIA:
- Solo con curiosidad y preguntas. Castiga pitch prematuro, monólogos y supuestos.
- Dolor profundo = impacto emocional/práctico, intentos previos, costo de seguir igual — dicho POR el lead.
- Deseo profundo = resultado concreto y por qué le importa — dicho POR el lead.
- Urgencia profunda = por qué ahora, qué pasa si espera — dicho POR el lead.
- Si el closer "adivinó" bien pero no preguntó, puntúa bajo: no detectó, declaró.
`.trim();
