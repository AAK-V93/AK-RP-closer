import { zonedDayKey, calendarDaysBetween } from "@/lib/crm-time";
import { nextLine, shortDate, type PersonFacts } from "@/lib/person-facts";
import { resolvePerson, whichOneQuestion, type ResolvablePerson } from "@/lib/person-resolve";

/**
 * The CRM chat answers the question that was asked, from that person's stored
 * data, and keeps the person in mind for «¿y…?», «él», «ella». Pure: the
 * route loads the rows and may ask the model to phrase the grounded answer.
 */

export type ChatTopic =
  | "objecion"
  | "ultimo"
  | "proximo"
  | "pago"
  | "decisor"
  | "telefono"
  | "oferta"
  | "mensaje"
  | "etapa"
  | "acuerdo"
  | "general";

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TOPICS: [ChatTopic, RegExp][] = [
  ["objecion", /\b(objecion|objeciones|que (le )?fren|que lo fren|que la fren|por que no (cerro|compro|quiso)|que (le )?preocup|que pero|que excusa|razon)/],
  ["ultimo", /\b(ultima vez|ultimo contacto|cuando hablamos|cuando habl[eo]|cuando (le )?escrib|cuando (lo|la) llame|hace cuanto|cuando fue la (llamada|reunion))/],
  ["proximo", /\b(cuando (le )?toca|para cuando|proximo|proxima|siguiente seguimiento|cuando (le )?(escribo|llamo)|que dia)/],
  ["pago", /\b(pago|pagado|pagar|cuanto debe|cuanto falta|saldo|cobr|forma de pago|cuotas?|presupuesto|cuanto (es|era)|precio)/],
  ["decisor", /\b(decide|decisor|quien decide|con quien lo consulta)/],
  ["telefono", /\b(telefono|numero|celular|whats ?app)/],
  ["mensaje", /\b(que le (digo|escribo|mando)|mensaje|como le escribo)/],
  ["etapa", /\b(etapa|en que seguimiento|cuantos seguimientos (le|lleva)|cuantos intentos|intento)/],
  ["oferta", /\b(oferta|programa|producto)/],
  ["acuerdo", /\b(en que qued|que quedamos|que qued|acuerdo|acordamos|que falta|pendiente|que paso|resumen|como va|como vamos)/],
];

export function chatTopic(text: string): ChatTopic {
  const q = fold(text);
  for (const [topic, pattern] of TOPICS) {
    if (pattern.test(q)) return topic;
  }
  return "general";
}

/** «¿A quién llamo hoy?», «¿Cuántos seguimientos tengo?»: about the list, not one person. */
export function isListQuestion(text: string) {
  const q = fold(text);
  return /\b(a quien(es)?|quienes|cuantos seguimientos tengo|cuantas personas|cuantos tengo|todos|todas|esta semana|lista)\b/.test(q) ||
    (/\b(hoy|manana)\b/.test(q) && !/\b(el|ella|con)\b/.test(q));
}

/** «¿y…?», «él», «ella», or a person question with no name: talks about the last person. */
export function isFollowOn(text: string) {
  const raw = text.trim();
  const q = fold(raw);
  if (/^(y|e)\b/.test(q)) return true;
  if (/(^|[\s¿¡,])(él|ella)(?=$|[\s?!.,])/i.test(raw)) return true;
  if (/\b(le|lo|la)\s+(puso|dije|escribi|llame|mande|toca|debe|pago|pagaste|ofreci)\b/.test(q)) return true;
  return chatTopic(raw) !== "general" && !isListQuestion(raw);
}

function daysAgo(day: string, today: string) {
  const diff = -calendarDaysBetween(day, today);
  if (diff <= 0) return "hoy";
  if (diff === 1) return "ayer";
  return `hace ${diff} días`;
}

/** The grounded answer. Short, natural, and only what is stored. */
export function answerAboutPerson(facts: PersonFacts, topic: ChatTopic, now = new Date()): string {
  const who = facts.firstName || facts.name;
  const today = zonedDayKey(now);
  const d = facts.details;
  switch (topic) {
    case "objecion": {
      if (d.objeciones) return `Lo que frenó a ${who} fue ${d.objeciones}.`;
      return facts.summary.clear
        ? `No quedó anotada una objeción de ${who}. Lo último: ${lowerFirst(facts.summary.agreed)}`
        : `No quedó anotada una objeción de ${who}.`;
    }
    case "ultimo": {
      if (!facts.lastContact) return `No tengo fechas de contacto con ${who}.`;
      const when = `el ${shortDate(facts.lastContact.day, today)} (${daysAgo(facts.lastContact.day, today)})`;
      if (facts.lastContact.kind === "call") return `La última vez que hablaron fue en la llamada del ${when.slice(3)}.`;
      const call = facts.lastCallDay ? ` La última llamada fue el ${shortDate(facts.lastCallDay, today)}.` : "";
      const result = facts.lastContact.resultado ? `, ${facts.lastContact.resultado.toLowerCase()}` : "";
      return `Lo último fue un seguimiento ${when}${result}.${call}`;
    }
    case "proximo": {
      const line = nextLine(facts, now);
      if (facts.ended) return `${who} ya no está en seguimiento (${facts.status.toLowerCase()}).`;
      return line ? `${line}.` : `No tienes una fecha guardada para ${who}.`;
    }
    case "pago": {
      const bits: string[] = [];
      if (d.pagado) bits.push(`${who} ha pagado ${d.pagado}`);
      else bits.push(`${who} no tiene pagos anotados`);
      if (d.presupuesto) bits.push(`hablaron de ${d.presupuesto}${d.formaPago ? ` (${d.formaPago.toLowerCase()})` : ""}`);
      else if (d.formaPago) bits.push(`la forma de pago fue ${d.formaPago.toLowerCase()}`);
      const tail = d.saldo ? ` Falta ${d.saldo}.` : "";
      return `${bits.join(" y ")}.${tail}`;
    }
    case "decisor":
      return d.decisor ? `Quien decide es ${d.decisor}.` : `No quedó anotado quién decide con ${who}.`;
    case "telefono":
      return facts.phone ? `El teléfono de ${who} es ${facts.phone}.` : `No tengo el teléfono de ${who}. Puedes agregarlo en su ficha.`;
    case "oferta":
      return facts.offer ? `${who} está en ${facts.offer}.` : `No tengo una oferta guardada para ${who}.`;
    case "mensaje":
      return facts.messages[0]
        ? `Podrías mandarle: «${facts.messages[0]}»`
        : `${who} no está en seguimiento, no te sugiero mensaje.`;
    case "etapa":
      return facts.stage ? `${facts.stage.label}.` : `${who} ya no está en seguimiento (${facts.status.toLowerCase()}).`;
    case "acuerdo":
    case "general":
    default: {
      const head = facts.summary.clear ? facts.summary.text : `Con ${who} no quedó claro el siguiente paso.`;
      const next = facts.ended ? "" : nextLine(facts, now);
      return next ? `${head} ${next}.` : head;
    }
  }
}

function lowerFirst(value: string) {
  return value.charAt(0).toLocaleLowerCase("es") + value.slice(1);
}

export type ChatTurnInput = {
  text: string;
  /** Person the previous turn talked about. */
  contextId?: string | null;
  /** A tap on a name sends its leadId. */
  leadId?: string | null;
};

export type ChatDecision<T extends ResolvablePerson> =
  | { kind: "person"; person: T; topic: ChatTopic }
  | { kind: "ask"; reply: string }
  | { kind: "list" };

/** Who the question is about, or that it is a list question for the follow-up panel. */
export function decideChatTurn<T extends ResolvablePerson>(input: ChatTurnInput, people: readonly T[]): ChatDecision<T> {
  const followOn = isFollowOn(input.text);
  const resolved = resolvePerson(input.text, people, {
    leadId: input.leadId,
    contextId: input.contextId,
    useContext: followOn,
  });
  if (resolved.kind === "one") return { kind: "person", person: resolved.person, topic: chatTopic(input.text) };
  if (resolved.kind === "ambiguous") return { kind: "ask", reply: whichOneQuestion(resolved.options) };
  if (resolved.kind === "unknown") {
    return { kind: "ask", reply: `No encontré a ${resolved.spoken} en tus prospectos. ¿Cómo aparece el nombre?` };
  }
  if (followOn && !isListQuestion(input.text)) {
    return { kind: "ask", reply: "¿De quién me hablas? Dime el nombre." };
  }
  return { kind: "list" };
}

/** Facts the model may use. Nothing else goes into the prompt. */
export function factsForModel(facts: PersonFacts, now = new Date()) {
  const today = zonedDayKey(now);
  return {
    nombre: facts.name,
    oferta: facts.offer || null,
    estado: facts.status,
    acuerdo: facts.summary.clear ? facts.summary.agreed : null,
    falta: facts.summary.missing || null,
    proximo: facts.nextDay ? nextLine(facts, now) : null,
    etapa: facts.stage?.label || null,
    ultimo_contacto: facts.lastContact
      ? { fecha: shortDate(facts.lastContact.day, today), tipo: facts.lastContact.kind === "call" ? "llamada" : "seguimiento", resultado: facts.lastContact.resultado || null }
      : null,
    ultima_llamada: facts.lastCallDay ? shortDate(facts.lastCallDay, today) : null,
    decisor: facts.details.decisor || null,
    objeciones: facts.details.objeciones || null,
    presupuesto: facts.details.presupuesto || null,
    forma_pago: facts.details.formaPago || null,
    pagado: facts.details.pagado || null,
    saldo: facts.details.saldo || null,
    notas: facts.details.notas,
    telefono: facts.phone ? "guardado" : null,
    historial: facts.history.slice(0, 8).map((item) => `${item.date}: ${item.label}`),
  };
}

export function chatPrompt(args: {
  question: string;
  history: { role: "user" | "crm"; text: string }[];
  facts: ReturnType<typeof factsForModel>;
  draft: string;
}) {
  return [
    "Eres el asistente de un closer de ventas. Respondes sobre UNA persona de su CRM.",
    "Español de tú, natural y breve: una o dos frases. Sin listas, sin saludos, sin plantillas.",
    "Responde exactamente lo que pregunta, usando solo DATOS. Si el dato no está, dilo en una frase. No inventes fechas, montos ni acuerdos.",
    "No hables de la grabación ni de la transcripción.",
    "La RESPUESTA_BASE ya es correcta; puedes decirla más natural pero no agregues hechos que no estén en DATOS.",
    'Devuelve solo JSON: {"reply": "..."}',
    "",
    `DATOS: ${JSON.stringify(args.facts)}`,
    `CONVERSACIÓN RECIENTE: ${JSON.stringify(args.history.slice(-6))}`,
    `PREGUNTA: ${args.question}`,
    `RESPUESTA_BASE: ${args.draft}`,
  ].join("\n");
}

/** Every number in the model's reply must already be in the facts or the base answer. */
export function groundedReply(reply: string, facts: unknown, draft: string) {
  const text = String(reply || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 420) return "";
  const known = `${JSON.stringify(facts)} ${draft}`;
  const numbers = text.match(/\d+(?:[.,]\d+)*/g) || [];
  if (numbers.some((n) => !known.includes(n))) return "";
  if (/transcrip|grabaci/i.test(text)) return "";
  return text;
}
