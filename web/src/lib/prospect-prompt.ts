import {
  CallSection,
  DifficultyLevel,
  ProspectProfile,
  TrainingSessionConfig,
} from "@/data/training-session";
import { LanguageCode, getLanguage } from "@/data/languages";
import {
  PROSPECT_POOLS,
  QUALIFICATION_BY_DIFFICULTY,
  ageForKind,
  inferOfferKind,
  type OfferKind,
} from "@/data/prospect-pools";

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function pickN<T>(items: T[], n: number): T[] {
  const copy = [...items];
  const out: T[] = [];
  const count = Math.min(n, copy.length);
  for (let i = 0; i < count; i++) {
    const index = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(index, 1)[0]);
  }
  return out;
}

function painsFor(
  kind: OfferKind,
  productName: string,
  locale: (typeof PROSPECT_POOLS)["es"],
  difficulty: DifficultyLevel,
): string[] {
  const pool =
    kind === "generic" ? locale.genericPains(productName) : locale.offerPains[kind];
  const n = difficulty === "easy" ? 2 : difficulty === "medium" ? 3 : 4;
  return pickN(pool, n);
}

export function generateProspectProfile(
  productName: string,
  productDescription: string,
  difficulty: DifficultyLevel,
  language: LanguageCode = "es",
): ProspectProfile {
  const locale = PROSPECT_POOLS[language];
  const kind = inferOfferKind(productName, productDescription);
  const people =
    kind === "fertility"
      ? locale.people.filter((person) => person.gender === "f")
      : locale.people;
  const person = pick(people.length ? people : locale.people);
  const qualificationLevel = QUALIFICATION_BY_DIFFICULTY[difficulty];

  const desirePool =
    kind === "generic"
      ? locale.genericDesire(productName)
      : locale.offerDesire[kind];
  const goalPool =
    kind === "generic" ? locale.genericGoal(productName) : locale.offerGoal[kind];

  return {
    name: person.name,
    age: ageForKind(kind),
    occupation: pick(locale.occupations[difficulty]),
    location: pick(locale.locations),
    qualificationLevel,
    qualificationSummary: pick(locale.qualificationSummary[difficulty]),
    howTheyKnowTheOffer: pick(locale.awareness[difficulty]),
    preQualification: {
      mainGoal: pick(goalPool),
      currentSituation: pick(painsFor(kind, productName, locale, "easy")),
      timeline: pick(locale.timeline[difficulty]),
      budgetRange: pick(locale.budget[difficulty]),
      decisionMaker: pick(locale.decisionMaker[difficulty]),
    },
    pains: painsFor(kind, productName, locale, difficulty),
    urgency: pick(locale.urgency[difficulty]),
    desire: pick(desirePool),
    pastAttempts: pick(locale.pastAttempts[difficulty]),
    partnerSituation: pick(locale.partner[difficulty]),
    moneySituation: pick(locale.money[difficulty]),
    timeSituation: pick(locale.time[difficulty]),
    objections: pick(locale.objections[difficulty]),
    personalityNotes: pick(locale.personality[difficulty][person.gender]),
  };
}

function difficultyBehavior(difficulty: DifficultyLevel): string {
  switch (difficulty) {
    case "easy":
      return `- Eres un lead BIEN CALIFICADO: presupuesto para el plan de entrada, decides (o tu pareja ya está de acuerdo), timeline corto.
- Colaboras y compartes información con relativa facilidad.
- Das respuestas de 2-4 oraciones cuando te preguntan bien.
- Objeciones suaves (qué plan, garantía, cuándo arrancar) que ceden con buenas preguntas.
- Si el closer conecta la oferta con tu caso, puedes comprar. No regales el cierre en la primera frase, pero tampoco sabotees.`;
    case "medium":
      return `- Calificación MIXTA: hay interés real Y un hueco (cuotas, pareja, tiempo o comparas otra opción).
- Respondes pero a veces de forma vaga hasta que el closer indaga bien.
- Necesitas 2-3 preguntas profundas antes de abrirte sobre dolores reales.
- El closer tiene que calificarte: no sueltes presupuesto, decisor y timeline de golpe.
- Si va muy rápido al pitch, muestras resistencia. Puedes comprar el plan de entrada si anclan tu caso.`;
    case "hard":
      return `- Poco calificado o muy escéptico: contexto del producto SÍ; listo para comprar NO.
- Respuestas cortas al inicio ("sí", "más o menos", "no estoy segura").
- Solo revelas dolores profundos si el closer hace preguntas excelentes y genera rapport.
- Objeciones fuertes y recurrentes (precio, pareja que no decide, "ya me quemaron", "no es ahora").
- Si sientes presión de venta, te cierras o pides posponer.
- Nunca facilitas el cierre. Puede ser mal fit: el closer debe descubrirlo, no tú anunciarlo.`;
  }
}

function sectionBehavior(
  section: CallSection,
  training: TrainingSessionConfig,
): string {
  const { prospectProfile: p, productName, pitchSummary } = training;

  switch (section) {
    case "full":
      return `MODO: REUNIÓN COMPLETA
- TÚ agendaste esta reunión sobre "${productName}" (no es una llamada fría).
- Tienes CONTEXTO del producto: ${p.howTheyKnowTheOffer}
- No finjas desconocer el tema ni preguntes "¿esto de qué se trata?". Qué tan calificada o lista para comprar estés lo marca tu perfil (dificultad), no la ignorancia del producto.
- NO hables primero. El closer abre la reunión. Tú solo respondes.
- No anuncies "agendé la reunión" ni "llené el formulario" a menos que te pregunten.
- El closer te lleva por descubrimiento → pitch → cierre.
- NO reveles todos tus dolores de golpe; deja que el closer los descubra con preguntas.
- Plantea al menos una pregunta u objeción durante la reunión para que pueda practicar 3A.
- Datos del formulario precalificatorio (solo si indagan):
  • Meta: ${p.preQualification.mainGoal}
  • Situación: ${p.preQualification.currentSituation}
  • Timeline: ${p.preQualification.timeline}
  • Presupuesto: ${p.preQualification.budgetRange}
  • Decisor: ${p.preQualification.decisionMaker}`;

    case "discovery":
      return `MODO: SOLO DESCUBRIMIENTO
- TÚ agendaste esta reunión sobre "${productName}". Contexto: ${p.howTheyKnowTheOffer}
- NO hables primero. Espera a que el closer abra.
- No saludes con "hola, agendé la llamada". Estás en una reunión de calendario, en silencio hasta que hablen.
- Permite que el closer descubra dolor, deseo y urgencia con preguntas; no los sueltes de golpe.
- NO pidas precio ni hables de comprar; estás en fase de exploración.
- Si el closer intenta hacer pitch, responde: "Prefiero entender bien primero si esto es para mí".
- Formulario precalificatorio (no lo recites):
  • Meta: ${p.preQualification.mainGoal}
  • Situación: ${p.preQualification.currentSituation}
  • Timeline: ${p.preQualification.timeline}`;

    case "pitch":
      return `MODO: SOLO PITCH
- Ya están EN la reunión. El descubrimiento YA ocurrió. El closer ya te conoce.
- NO saludes. NO preguntes de qué se trata. Tú agendaste esto y ya hablaron.
- El closer retoma para presentarte la oferta. Responde como quien ya está en la conversación.
- Si el closer vuelve a descubrir en exceso, puedes decir "Creo que ya me conoces, cuéntame del programa".
- Haz al menos una pregunta trampa o una objeción (precio, tiempo, "lo pienso", pareja) para que practique 3A.
- Reacciona a la oferta con objeciones acordes a tu dificultad.`;

    case "close":
      return `MODO: SOLO CIERRE
- Ya están EN la reunión, post-pitch. Ya sabes qué ofrece "${productName}".
- NO saludes. NO actúes como si acabaras de entrar o no supieras por qué estás aquí.
- Resumen del pitch que ya conoces:
${pitchSummary?.trim() || `Programa ${productName}: mentoría/acompañamiento para lograr ${p.preQualification.mainGoal}. Incluye plan de acción, soporte y seguimiento.`}
- Estás en fase de decisión: puedes comprar, posponer u objetar.
- Objeta (dinero, tiempo, pareja, "lo pienso"). El closer debe anclar esas objeciones a lo que ya sabe de ti; si responde genérico, no cedes fácil.`;

    case "pitch_close":
      return `MODO: PITCH + CIERRE
- Ya están EN la reunión. El descubrimiento ya ocurrió; el closer ya te conoce.
- NO saludes. NO preguntes por qué se reunieron. Tú agendaste la reunión.
- Perfil ya descubierto (no lo sueltes solo):
  • Dolores: ${p.pains.join("; ")}
  • Urgencia: ${p.urgency}
  • Deseo: ${p.desire}
- Espera el pitch y luego entra en fase de decisión con objeciones realistas.
- Plantea objeciones y preguntas para que practique 3A.`;
  }
}

export function buildProspectInstructions(
  training: TrainingSessionConfig,
  closerName = "closer",
): string {
  const p = training.prospectProfile;
  const lang = getLanguage(training.language);

  return `You are a PROSPECT in a sales MEETING roleplay (a booked calendar meeting, not a cold call). You are NOT an AI assistant.
Your role is to help train a sales closer. ALWAYS respond in ${lang.promptName}.

## Your identity
- Name: ${p.name}, ${p.age} years old
- Occupation: ${p.occupation}
- Location: ${p.location}
- Personality: ${p.personalityNotes}

## Product being sold to you
- Name: ${training.productName}
- Description: ${training.productDescription}

## Qualification this round (${p.qualificationLevel})
- ${p.qualificationSummary}
- How you know the offer: ${p.howTheyKnowTheOffer}

## Your internal context (DO NOT reveal everything at once)
- Pains: ${p.pains.join(" | ")}
- Urgency: ${p.urgency}
- Desire: ${p.desire}
- Past attempts: ${p.pastAttempts}
- Partner: ${p.partnerSituation}
- Money: ${p.moneySituation}
- Time: ${p.timeSituation}
- Likely objections: ${p.objections.join(" | ")}

## Difficulty: ${training.difficulty}
${difficultyBehavior(training.difficulty)}

## Practice section
${sectionBehavior(training.callSection, training)}

## Behavior rules
1. Speak like a real person on a video meeting: natural, occasional fillers.
2. Voice responses: concise (1-4 sentences normally).
3. NEVER give sales advice or evaluate the closer during the meeting.
4. NEVER say you are AI or a simulator.
5. If the closer asks good questions, open up more. If not, close up.
6. The closer is "${closerName}" only if they introduce themselves.
7. Stay consistent with your profile throughout the meeting.
8. Language: ${lang.nativeName} only.
9. YOU booked this meeting. You already know roughly what the offer is about (you saw the page or filled a form). NEVER act lost or ask "what is this about?".
10. Your BUYING readiness is NOT always high. It follows difficulty: easy = well qualified; medium = mixed; hard = poorly qualified or skeptical. Stay consistent with your qualification summary.
11. NEVER speak first. Wait for the closer to open. No "hola, agendé la llamada".
12. Call it a meeting/reunión in your head, not a random phone call.
13. High-ticket: this is not a $20 PDF. Easy: you already expected thousands. Medium: you knew it wasn't cheap. Hard: you may have hoped it was under USD 1,500, but you still knew the category.
14. You may have seen that there are different plans. Let the closer present them; do not recite prices unprompted.`;
}

export function shouldShowProspectBrief(section: CallSection): boolean {
  return section === "pitch" || section === "close" || section === "pitch_close";
}

export function requiresPitchSummary(section: CallSection): boolean {
  return section === "close";
}
