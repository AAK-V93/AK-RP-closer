import { closerSpanish } from "@/lib/closer-spanish";

export type RubricPhase = "descubrimiento" | "objeciones";

export interface RubricCriterion {
  id: string;
  phase: RubricPhase;
  label: string;
  description: string;
  /** Weighted more heavily in coaching feedback */
  critical?: boolean;
}

export function shownRubricLabel(id: string, stored?: string) {
  return closerSpanish(RUBRIC_CRITERIA.find((row) => row.id === id)?.label || stored || id);
}

export const RUBRIC_CRITERIA: RubricCriterion[] = [
  {
    id: "pain",
    phase: "descubrimiento",
    label: "Dolor a profundidad",
    description:
      "Descubrió el dolor real del prospecto con preguntas curiosas, no con supuestos ni una presentación de la oferta. Llegó más allá de la queja superficial: impacto, historia, qué ha intentado.",
    critical: true,
  },
  {
    id: "desire",
    phase: "descubrimiento",
    label: "Deseo a profundidad",
    description:
      "Descubrió qué quiere lograr y por qué le importa, con preguntas. El prospecto verbalizó el resultado deseado; el closer no se lo puso en la boca.",
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
    label: "Reconoce lo que dijo",
    description:
      "Ante una pregunta u objeción, reformuló lo que el prospecto dijo, validó y compró tiempo. No discutió ni invalidó.",
  },
  {
    id: "aaa_associate",
    phase: "objeciones",
    label: "Asocia con quien sí compra",
    description:
      "Asoció la pregunta/objeción con el tipo de persona que obtiene buenos resultados (label positivo, cliente exitoso, autoridad). El prospecto da un paso atrás y se siente más cerca de comprar, no más lejos.",
  },
  {
    id: "aaa_ask",
    phase: "objeciones",
    label: "Devuelve la pregunta",
    description:
      "Preguntó sobre la pregunta. No respondió trampas de inmediato. Mantuvo el control. No cedió el volante con «¿tienes alguna pregunta?».",
    critical: true,
  },
  {
    id: "use_discovery",
    phase: "objeciones",
    label: "Usa el descubrimiento en la objeción",
    description:
      "Cada objeción se reencuadra con dolor, deseo, urgencia y citas concretas del prospecto. Un marco genérico, sin citar el caso, no basta. No downsell prematuro. Aísla la objeción y la ancla al costo de inacción que ya salió.",
    critical: true,
  },
];

const DISCOVERY_IDS = new Set(["pain", "desire", "urgency"]);
const CLOSE_IDS = new Set([
  "aaa_acknowledge",
  "aaa_associate",
  "aaa_ask",
  "use_discovery",
]);

/** Practice mode still exists; scoring follows the section. */
export function getCriteriaForSection(section?: string): RubricCriterion[] {
  switch (section) {
    case "pitch":
    case "close":
    case "pitch_close":
      return RUBRIC_CRITERIA.filter((c) => CLOSE_IDS.has(c.id));
    case "discovery":
      return RUBRIC_CRITERIA.filter(
        (c) => DISCOVERY_IDS.has(c.id) || c.id.startsWith("aaa_"),
      );
    case "full":
    default:
      return RUBRIC_CRITERIA;
  }
}

export function sectionEvalNotes(section?: string): string {
  switch (section) {
    case "discovery":
      return `MODO SOLO DESCUBRIMIENTO: evalúa dolor, deseo y urgencia (con preguntas). También Reconoce, Relaciona y Devuelve la pregunta si el prospecto pregunta u objeta. No penalices por no presentar la oferta ni por no cerrar.`;
    case "pitch":
      return `MODO SOLO PRESENTACIÓN DE LA OFERTA: el descubrimiento YA ocurrió (ficha del prospecto). NO penalices por no re-interrogar. Evalúa Reconoce, Relaciona y Devuelve la pregunta Y si usó dolor, deseo y urgencia conocidos al manejar objeciones. Si reabre un descubrimiento pesado, menciónalo en improvements.`;
    case "close":
      return `MODO SOLO CIERRE: el prospecto ya oyó la presentación de la oferta. Evalúa Reconoce, Relaciona y Devuelve la pregunta Y si cada objeción se ancla a lo descubierto (ficha + transcripción). Un marco genérico ("entiendo, es una gran pregunta") sin citar su dolor o urgencia es INSUFICIENTE.`;
    case "pitch_close":
      return `MODO PRESENTACIÓN DE LA OFERTA + CIERRE: el descubrimiento ya ocurrió. Evalúa Reconoce, Relaciona y Devuelve la pregunta y el uso del descubrimiento en las objeciones. No penalices por no redescubrir.`;
    case "full":
    default:
      return `MODO LLAMADA COMPLETA: evalúa dolor, deseo y urgencia en el descubrimiento Y Reconoce, Relaciona y Devuelve la pregunta en cada pregunta u objeción.`;
  }
}

/**
 * Condensed Reconoce / Relaciona / Devuelve la pregunta notes for the evaluator.
 * Source: Hormozi reframing training.
 */
export const AAA_EVALUATOR_BRIEF = `
MARCO RECONOCE, RELACIONA Y DEVUELVE LA PREGUNTA (reencuadre después de cualquier cosa que no sea "sí"):

1) RECONOCE — Di de vuelta lo que dijeron. Beneficios: sienten que escuchas; te compra 2–3 segundos para pensar. Nunca discutes ni invalidas. Tono: "totalmente entiendo", "es una pregunta justa", "huh, interesante".

2) RELACIONA — Vincula su pregunta u objeción con el comportamiento de quien mejor resultado saca de tu oferta. Si se alejan de comprar, el reencuadre dice: esa pregunta en realidad te hace MÁS el tipo de cliente que compra. Ejemplos:
   - "Es una gran pregunta; de hecho la hacen mucho nuestros mejores clientes."
   - "Eso muestra que estás tomando una decisión seria / racional."
   - Un tercero: "hoy alguien me preguntó lo mismo, ¿te cuento lo que le dije?" / "te pareces a Sarah, que también tenía ese recelo y le fue muy bien" / "Alex me dijo esto hoy, ¿te lo comparto?"
   Ese tercero permite verdades duras sin insultar al prospecto.

3) DEVUELVE LA PREGUNTA — Pregunta sobre la pregunta. Quien pregunta controla la conversación. No contestes trampas (certificaciones, número de tickets, "tengo que pensarlo") hasta saber qué están juzgando. Ejemplos:
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
- Curiosidad infantil siempre: busca entender, no ganar. Si se siente combativo, ya perdiste.
- No asumas qué preguntan: la mayoría no sabe ni ellos. Pregunta sobre su pregunta.
- "necesito pensarlo" / "no tengo tiempo" / "tengo que hablarlo con mi pareja" / "odio esta parte" NO son fin de la venta: Reconoce + Relaciona + una pregunta específica.
- Si no sabes la respuesta, SIEMPRE puedes preguntar más sobre su pregunta.

CÓMO SE DESCUBRE DOLOR / DESEO / URGENCIA:
- Solo con curiosidad y preguntas. Castiga una presentación de la oferta prematura, monólogos y supuestos.
- Dolor profundo = impacto emocional/práctico, intentos previos, costo de seguir igual — dicho POR el prospecto.
- Deseo profundo = resultado concreto y por qué le importa — dicho POR el prospecto.
- Urgencia profunda = por qué ahora, qué pasa si espera — dicho POR el prospecto.
- Si el closer "adivinó" bien pero no preguntó, puntúa bajo: no detectó, declaró.

USAR EL DESCUBRIMIENTO EN EL CIERRE (calidad tipo QC de llamada real):
- Ante "está caro" / "lo hablo con mi pareja" / "no es el momento", el closer DEBE traer de vuelta lo que el prospecto ya dijo: tiempo con el problema, pérdida, DIY que no funcionó, "ahora es necesario", citas textuales.
- Ejemplo de anclaje correcto: «Me comentaste que llevan 2.5 años, hubo una pérdida, y tu médico dijo que ya deberían haber quedado embarazados. Si el dinero no fuera el tema hoy, ¿hay algo más que te frene?»
- Ejemplo insuficiente: «Entiendo, es una inversión, ¿qué te preocupa del precio?» (marco vacío, no usa el caso).
- Extrae la RAÍZ de la objeción (flujo de caja ≠ insolvencia; "hablarlo" ≠ falta de tiempo).
- Si el closer downsellea o acepta reagendar sin aislar ni anclar al dolor/urgencia, falló.
- Conecta fallas de descubrimiento con objeciones posteriores: lo que no se profundizó (urgencia, dolor residual, DIY) es lo que alimenta el "no estaba en los planes".
`.trim();
