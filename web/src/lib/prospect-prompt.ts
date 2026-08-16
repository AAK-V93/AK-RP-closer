import {
  CallSection,
  DifficultyLevel,
  ProspectProfile,
  TrainingSessionConfig,
} from "@/data/training-session";
import { LanguageCode, getLanguage } from "@/data/languages";

const LOCALE_DATA: Record<
  LanguageCode,
  {
    firstNames: string[];
    occupations: string[];
    locations: string[];
    painTemplates: (product: string) => string[];
    urgency: Record<DifficultyLevel, string>;
    desire: (product: string) => string;
    pastAttempts: Record<DifficultyLevel, string>;
    partner: Record<DifficultyLevel, string>;
    money: Record<DifficultyLevel, string>;
    time: Record<DifficultyLevel, string>;
    objections: Record<DifficultyLevel, string[]>;
    personality: Record<DifficultyLevel, string>;
    preQual: {
      mainGoal: (product: string) => string;
      currentSituation: (desc: string) => string;
      timeline: Record<DifficultyLevel, string>;
      budget: Record<DifficultyLevel, string>;
      decisionMaker: Record<DifficultyLevel, string>;
    };
  }
> = {
  es: {
    firstNames: ["María", "Carlos", "Lucía", "Andrés", "Valentina", "Diego"],
    occupations: [
      "Emprendedora digital",
      "Consultor independiente",
      "Coach de negocios",
      "Dueño de e-commerce",
    ],
    locations: ["Ciudad de México", "Bogotá", "Buenos Aires", "Madrid", "Lima"],
    painTemplates: (product) => [
      `Siento que ${product} podría ayudarme pero no estoy 100% segura`,
      "He invertido antes en cosas que no funcionaron",
      "Me cuesta mantener la consistencia",
      "No tengo claridad sobre el siguiente paso",
    ],
    urgency: {
      easy: "Quiero avanzar pronto pero sin presión",
      medium: "Sé que debería actuar pero llevo semanas posponiéndolo",
      hard: "Llevo meses posponiéndolo y desconfío del timing",
    },
    desire: (product) => `Quiero resultados tangibles con ${product}`,
    pastAttempts: {
      easy: "He leído y tomado cursos gratis",
      medium: "Compré un programa hace un año que no cumplió",
      hard: "Ya probé dos programas similares sin resultados",
    },
    partner: {
      easy: "Mi pareja apoya la decisión",
      medium: "Mi pareja apoya pero quiere ver números claros",
      hard: "Mi pareja es escéptica y cuestiona cualquier inversión",
    },
    money: {
      easy: "Puedo invertir si veo valor claro",
      medium: "Depende del ROI y las cuotas",
      hard: "Tengo ingresos irregulares y debo priorizar gastos",
    },
    time: {
      easy: "Puedo dedicar 1-2 horas diarias",
      medium: "Tengo tiempo limitado entre semana",
      hard: "Trabajo muchas horas, encajar esto es complicado",
    },
    objections: {
      easy: ["Necesito pensarlo un poco", "¿Hay garantía?"],
      medium: [
        "Es caro para mí ahora",
        "Tengo que hablarlo con mi pareja",
        "¿Y si no funciona?",
      ],
      hard: [
        "Ya me quemaron con algo parecido",
        "No creo que funcione para mi caso",
        "Prefiero esperar unos meses",
      ],
    },
    personality: {
      easy: "Amable, responde con detalle, abierta",
      medium: "Educada pero reservada; hay que indagar",
      hard: "Directa, escéptica, respuestas cortas hasta generar confianza",
    },
    preQual: {
      mainGoal: (p) => `Quiero avanzar con ${p}`,
      currentSituation: (d) => d.slice(0, 120) || "Busco una solución concreta",
      timeline: {
        easy: "Quiero resultados en 1-3 meses",
        medium: "Me urge resolver esto en los próximos 1-3 meses",
        hard: "No tengo prisa, quiero evaluar bien",
      },
      budget: {
        easy: "Tengo presupuesto si veo valor claro",
        medium: "Depende del ROI y las cuotas",
        hard: "El precio es mi principal freno",
      },
      decisionMaker: {
        easy: "Yo decido",
        medium: "Yo decido, pero consulto a mi pareja",
        hard: "Decido con mi pareja, no solo yo",
      },
    },
  },
  en: {
    firstNames: ["Sarah", "James", "Emily", "Michael", "Jessica", "David"],
    occupations: [
      "Digital entrepreneur",
      "Independent consultant",
      "Business coach",
      "E-commerce owner",
    ],
    locations: ["New York", "Miami", "Los Angeles", "London", "Toronto"],
    painTemplates: (product) => [
      `I feel ${product} could help but I'm not 100% sure`,
      "I've invested before in things that didn't work",
      "I struggle to stay consistent",
      "I lack clarity on the next step",
    ],
    urgency: {
      easy: "I want to move forward soon but without pressure",
      medium: "I know I should act but I've been postponing for weeks",
      hard: "I've been postponing for months and I'm skeptical about timing",
    },
    desire: (product) => `I want tangible results with ${product}`,
    pastAttempts: {
      easy: "I've read books and taken free courses",
      medium: "I bought a program last year that didn't deliver",
      hard: "I've tried two similar programs with no results",
    },
    partner: {
      easy: "My partner supports the decision",
      medium: "My partner supports but wants to see clear numbers",
      hard: "My partner is skeptical and questions any investment",
    },
    money: {
      easy: "I can invest if I see clear value",
      medium: "It depends on ROI and payment plans",
      hard: "I have irregular income and must prioritize expenses",
    },
    time: {
      easy: "I can dedicate 1-2 hours daily",
      medium: "I have limited time on weekdays",
      hard: "I work long hours, fitting this in is hard",
    },
    objections: {
      easy: ["I need to think about it", "Is there a guarantee?"],
      medium: [
        "It's expensive for me right now",
        "I need to talk to my partner",
        "What if it doesn't work?",
      ],
      hard: [
        "I've been burned before with something similar",
        "I don't think it'll work for my case",
        "I'd rather wait a few months",
      ],
    },
    personality: {
      easy: "Friendly, shares details openly",
      medium: "Polite but reserved; needs good probing",
      hard: "Direct, skeptical, short answers until trust is built",
    },
    preQual: {
      mainGoal: (p) => `I want to move forward with ${p}`,
      currentSituation: (d) => d.slice(0, 120) || "Looking for a concrete solution",
      timeline: {
        easy: "I want results in 1-3 months",
        medium: "I need to solve this in the next 1-3 months",
        hard: "No rush, I want to evaluate carefully",
      },
      budget: {
        easy: "I have budget if I see clear value",
        medium: "Depends on ROI and installments",
        hard: "Price is my main concern",
      },
      decisionMaker: {
        easy: "I decide alone",
        medium: "I decide but consult my partner",
        hard: "I decide with my partner, not alone",
      },
    },
  },
  pt: {
    firstNames: ["Ana", "Pedro", "Juliana", "Rafael", "Camila", "Lucas"],
    occupations: [
      "Empreendedora digital",
      "Consultor independente",
      "Coach de negócios",
      "Dono de e-commerce",
    ],
    locations: ["São Paulo", "Rio de Janeiro", "Lisboa", "Buenos Aires"],
    painTemplates: (product) => [
      `Sinto que ${product} poderia me ajudar mas não tenho 100% de certeza`,
      "Já investi antes em coisas que não funcionaram",
      "Tenho dificuldade em manter consistência",
      "Não tenho clareza sobre o próximo passo",
    ],
    urgency: {
      easy: "Quero avançar em breve mas sem pressão",
      medium: "Sei que deveria agir mas venho adiando há semanas",
      hard: "Adio há meses e desconfio do timing",
    },
    desire: (product) => `Quero resultados tangíveis com ${product}`,
    pastAttempts: {
      easy: "Li livros e fiz cursos gratuitos",
      medium: "Comprei um programa ano passado que não cumpriu",
      hard: "Já tentei dois programas similares sem resultado",
    },
    partner: {
      easy: "Meu parceiro apoia a decisão",
      medium: "Meu parceiro apoia mas quer ver números claros",
      hard: "Meu parceiro é cético e questiona qualquer investimento",
    },
    money: {
      easy: "Posso investir se vir valor claro",
      medium: "Depende do ROI e das parcelas",
      hard: "Tenho renda irregular e preciso priorizar gastos",
    },
    time: {
      easy: "Posso dedicar 1-2 horas por dia",
      medium: "Tenho tempo limitado durante a semana",
      hard: "Trabalho muitas horas, encaixar isso é difícil",
    },
    objections: {
      easy: ["Preciso pensar um pouco", "Tem garantia?"],
      medium: [
        "Está caro para mim agora",
        "Preciso falar com meu parceiro",
        "E se não funcionar?",
      ],
      hard: [
        "Já me queimei com algo parecido",
        "Não acredito que funcione no meu caso",
        "Prefiro esperar alguns meses",
      ],
    },
    personality: {
      easy: "Amável, responde com detalhes, aberta",
      medium: "Educada mas reservada; precisa de boas perguntas",
      hard: "Direta, cética, respostas curtas até gerar confiança",
    },
    preQual: {
      mainGoal: (p) => `Quero avançar com ${p}`,
      currentSituation: (d) => d.slice(0, 120) || "Busco uma solução concreta",
      timeline: {
        easy: "Quero resultados em 1-3 meses",
        medium: "Preciso resolver isso nos próximos 1-3 meses",
        hard: "Sem pressa, quero avaliar bem",
      },
      budget: {
        easy: "Tenho orçamento se vir valor claro",
        medium: "Depende do ROI e das parcelas",
        hard: "O preço é meu principal obstáculo",
      },
      decisionMaker: {
        easy: "Eu decido",
        medium: "Eu decido, mas consulto meu parceiro",
        hard: "Decido com meu parceiro, não sozinha",
      },
    },
  },
  fr: {
    firstNames: ["Marie", "Pierre", "Sophie", "Thomas", "Camille", "Lucas"],
    occupations: [
      "Entrepreneure digitale",
      "Consultante indépendante",
      "Coach business",
      "Propriétaire e-commerce",
    ],
    locations: ["Paris", "Montréal", "Bruxelles", "Genève"],
    painTemplates: (product) => [
      `Je sens que ${product} pourrait m'aider mais je ne suis pas sûre à 100%`,
      "J'ai déjà investi dans des choses qui n'ont pas marché",
      "J'ai du mal à rester constante",
      "Je manque de clarté sur la prochaine étape",
    ],
    urgency: {
      easy: "Je veux avancer bientôt mais sans pression",
      medium: "Je sais que je devrais agir mais je repousse depuis des semaines",
      hard: "Je repousse depuis des mois et je doute du timing",
    },
    desire: (product) => `Je veux des résultats concrets avec ${product}`,
    pastAttempts: {
      easy: "J'ai lu et suivi des cours gratuits",
      medium: "J'ai acheté un programme l'an dernier qui n'a pas tenu ses promesses",
      hard: "J'ai déjà essayé deux programmes similaires sans résultat",
    },
    partner: {
      easy: "Mon partenaire soutient la décision",
      medium: "Mon partenaire soutient mais veut voir des chiffres clairs",
      hard: "Mon partenaire est sceptique et remet en question tout investissement",
    },
    money: {
      easy: "Je peux investir si je vois une valeur claire",
      medium: "Ça dépend du ROI et des facilités de paiement",
      hard: "J'ai des revenus irréguliers et je dois prioriser",
    },
    time: {
      easy: "Je peux consacrer 1-2 heures par jour",
      medium: "J'ai peu de temps en semaine",
      hard: "Je travaille beaucoup, c'est difficile à caser",
    },
    objections: {
      easy: ["J'ai besoin d'y réfléchir", "Y a-t-il une garantie?"],
      medium: [
        "C'est cher pour moi maintenant",
        "Je dois en parler à mon partenaire",
        "Et si ça ne marche pas?",
      ],
      hard: [
        "Je me suis déjà fait avoir avec quelque chose de similaire",
        "Je ne pense pas que ça marchera pour mon cas",
        "Je préfère attendre quelques mois",
      ],
    },
    personality: {
      easy: "Aimable, partage des détails, ouverte",
      medium: "Polie mais réservée; il faut creuser",
      hard: "Directe, sceptique, réponses courtes jusqu'à la confiance",
    },
    preQual: {
      mainGoal: (p) => `Je veux avancer avec ${p}`,
      currentSituation: (d) => d.slice(0, 120) || "Je cherche une solution concrète",
      timeline: {
        easy: "Je veux des résultats en 1-3 mois",
        medium: "Je dois résoudre ça dans les 1-3 prochains mois",
        hard: "Pas pressée, je veux bien évaluer",
      },
      budget: {
        easy: "J'ai un budget si je vois une valeur claire",
        medium: "Ça dépend du ROI et des paiements",
        hard: "Le prix est mon principal frein",
      },
      decisionMaker: {
        easy: "Je décide seule",
        medium: "Je décide mais je consulte mon partenaire",
        hard: "Je décide avec mon partenaire, pas seule",
      },
    },
  },
};

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function generateProspectProfile(
  productName: string,
  productDescription: string,
  difficulty: DifficultyLevel,
  language: LanguageCode = "es",
): ProspectProfile {
  const locale = LOCALE_DATA[language];
  const name = pick(locale.firstNames);
  const age = 28 + Math.floor(Math.random() * 15);
  const pains = locale.painTemplates(productName);
  const extraPains =
    difficulty === "hard"
      ? pains
      : difficulty === "medium"
        ? pains.slice(0, 4)
        : pains.slice(0, 3);

  return {
    name,
    age,
    occupation: pick(locale.occupations),
    location: pick(locale.locations),
    preQualification: {
      mainGoal: locale.preQual.mainGoal(productName),
      currentSituation: locale.preQual.currentSituation(productDescription),
      timeline: locale.preQual.timeline[difficulty],
      budgetRange: locale.preQual.budget[difficulty],
      decisionMaker: locale.preQual.decisionMaker[difficulty],
    },
    pains: extraPains,
    urgency: locale.urgency[difficulty],
    desire: locale.desire(productName),
    pastAttempts: locale.pastAttempts[difficulty],
    partnerSituation: locale.partner[difficulty],
    moneySituation: locale.money[difficulty],
    timeSituation: locale.time[difficulty],
    objections: locale.objections[difficulty],
    personalityNotes: locale.personality[difficulty],
  };
}

function difficultyBehavior(difficulty: DifficultyLevel): string {
  switch (difficulty) {
    case "easy":
      return `- Colaboras y compartes información con relativa facilidad.
- Das respuestas de 2-4 oraciones cuando te preguntan bien.
- Tienes objeciones suaves que ceden con buenas preguntas.
- No interrumpes; escuchas antes de responder.`;
    case "medium":
      return `- Respondes pero a veces de forma vaga hasta que el closer indaga bien.
- Necesitas 2-3 preguntas profundas antes de abrirte sobre dolores reales.
- Presentas objeciones de tiempo, dinero o pareja de forma realista.
- Si el closer va muy rápido al pitch, muestras resistencia.`;
    case "hard":
      return `- Eres escéptica: respuestas cortas al inicio ("sí", "más o menos", "no estoy segura").
- Solo revelas dolores profundos si el closer hace preguntas excelentes y genera rapport.
- Objeciones fuertes y recurrentes; comparas con malas experiencias pasadas.
- Si sientes presión de venta, te cierras o pides posponer.
- Nunca facilitas el cierre: el closer debe ganárselo.`;
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
- Ya llenaste un formulario; sabes de qué va el tema. No finjas desorientación.
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
- TÚ agendaste esta reunión sobre "${productName}". Ya hay contexto previo.
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
9. YOU booked this meeting. You know why you are here. Never act lost or ask "what is this about?".
10. NEVER speak first. Wait for the closer to open. No "hola, agendé la llamada".
11. Call it a meeting/reunión in your head, not a random phone call.`;
}

export function shouldShowProspectBrief(section: CallSection): boolean {
  return section === "pitch" || section === "close" || section === "pitch_close";
}

export function requiresPitchSummary(section: CallSection): boolean {
  return section === "close";
}
