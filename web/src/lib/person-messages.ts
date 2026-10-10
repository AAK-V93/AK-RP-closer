/**
 * Suggested WhatsApp messages built from what THIS person agreed, what is
 * pending and what stopped them. Second person, short, natural. Never the
 * summary pasted in, never a fact we don't have. Nothing known → one honest
 * check-in. Perdidos get none: there is no next step to close.
 */
export type MessageFacts = {
  firstName: string;
  offer: string;
  status: "open" | "won" | "lost";
  /** What was agreed, whole sentences (may be empty). */
  agreed: string;
  /** Follow-up kind stored on the call (DECISION, COBRANZA, SEGUNDA_REUNION…). */
  tipo: string;
  /** Raw razón / objeción as stored («Necesita consultarlo con alguien», «Precio / No tiene dinero»). */
  objection: string;
  /** Who decides, as stored («Su socia»). */
  decisor: string;
  /** Money still owed on a sale, already formatted («USD 531»), or empty. */
  falta: string;
};

function fold(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const WHO = /\b(su |tu )?(socia|socio|socios|esposa|esposo|pareja|marido|mujer|contador|contadora|equipo|familia|jefe|jefa|hermano|hermana|mama|papa)\b/;

/** «tu socia», «tu esposo»: the person they had to talk to, from the stored text only. */
export function whoToConsult(...texts: string[]) {
  for (const text of texts) {
    const match = fold(text || "").match(WHO);
    if (match) {
      const word = match[2] === "mama" ? "mamá" : match[2] === "papa" ? "papá" : match[2];
      return `tu ${word}`;
    }
  }
  return "";
}

function hi(name: string) {
  return name ? `Hola ${name}` : "Hola";
}

export function personMessages(facts: MessageFacts): string[] {
  const name = facts.firstName.trim();
  const offer = facts.offer.trim();
  const agreed = fold(facts.agreed);
  const tipo = fold(facts.tipo).replace(/_/g, " ");
  const objection = fold(facts.objection);
  const out: string[] = [];
  const add = (text: string) => {
    if (text && !out.includes(text)) out.push(text);
  };

  if (facts.status === "lost") return [];

  if (facts.status === "won") {
    add(`${hi(name)}, ¿cómo vas arrancando${offer ? ` con ${offer}` : ""}? Cualquier duda, me escribes.`);
    if (facts.falta) add(`${hi(name)}, te escribo por el saldo pendiente de ${facts.falta}. ¿Cuándo te queda bien hacerlo?`);
    return out.slice(0, 2);
  }

  const who = whoToConsult(facts.agreed, facts.decisor, facts.objection);
  const consult = /consult|hablar|hablarlo|decid/.test(objection) || /consult|hablar con|hablarlo/.test(agreed);
  if (who && consult) {
    add(`${hi(name)}, ¿pudiste hablarlo con ${who}?`);
    add(`${hi(name)}, ¿qué te dijo ${who}? Si quieren, lo vemos juntos en una llamada corta.`);
  } else if (consult) {
    add(`${hi(name)}, ¿pudiste hablarlo con quien lo ibas a consultar?`);
  }
  if (/precio|dinero|caro|monto|presupuesto/.test(objection)) {
    add(`${hi(name)}, ¿pudiste revisar los números con calma? Si el monto es lo que te frena, lo conversamos.`);
  }
  if (/cobr|pago/.test(tipo) || /link de pago|transferencia|pagar|cuota/.test(agreed)) {
    add(/link/.test(agreed) ? `${hi(name)}, ¿cómo vas con el pago? Si necesitas el link otra vez, te lo paso.` : `${hi(name)}, ¿cómo vas con el pago?`);
  }
  if (/segunda|reunion/.test(tipo) || /segunda reunion/.test(agreed)) {
    add(`${hi(name)}, ¿agendamos la segunda reunión? Dime qué día te queda mejor.`);
  }
  if (/revis|propuesta|evalu/.test(agreed) || /decision/.test(tipo)) {
    add(`${hi(name)}, ¿pudiste revisar la propuesta? Me cuentas qué te pareció.`);
  }
  if (!out.length) {
    add(`${hi(name)}, ¿cómo estás? ¿Tienes un momento esta semana para retomar lo que hablamos?`);
  }
  return out.slice(0, 3);
}
