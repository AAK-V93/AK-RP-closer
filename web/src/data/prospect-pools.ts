import { DifficultyLevel } from "@/data/training-session";
import { LanguageCode } from "@/data/languages";

export type LeadGender = "f" | "m";
export type OfferKind = "fertility" | "coaching" | "fitness" | "generic";
export type QualificationLevel = "high" | "mixed" | "low";

export const QUALIFICATION_BY_DIFFICULTY: Record<
  DifficultyLevel,
  QualificationLevel
> = {
  easy: "high",
  medium: "mixed",
  hard: "low",
};

export interface NamedPerson {
  name: string;
  gender: LeadGender;
}

export interface LocalePools {
  people: NamedPerson[];
  locations: string[];
  occupations: Record<DifficultyLevel, string[]>;
  awareness: Record<DifficultyLevel, string[]>;
  timeline: Record<DifficultyLevel, string[]>;
  budget: Record<DifficultyLevel, string[]>;
  decisionMaker: Record<DifficultyLevel, string[]>;
  urgency: Record<DifficultyLevel, string[]>;
  pastAttempts: Record<DifficultyLevel, string[]>;
  partner: Record<DifficultyLevel, string[]>;
  money: Record<DifficultyLevel, string[]>;
  time: Record<DifficultyLevel, string[]>;
  objections: Record<DifficultyLevel, string[][]>;
  personality: Record<DifficultyLevel, Record<LeadGender, string[]>>;
  qualificationSummary: Record<DifficultyLevel, string[]>;
  genericPains: (product: string) => string[];
  genericDesire: (product: string) => string[];
  genericGoal: (product: string) => string[];
  offerPains: Record<Exclude<OfferKind, "generic">, string[]>;
  offerDesire: Record<Exclude<OfferKind, "generic">, string[]>;
  offerGoal: Record<Exclude<OfferKind, "generic">, string[]>;
}

export function inferOfferKind(productName: string, productDescription: string): OfferKind {
  const text = `${productName} ${productDescription}`.toLowerCase();
  if (
    /embaraz|fertil|concebir|concep|nutrici[oó]n funcional|nutrition fonctionnelle/.test(
      text,
    )
  ) {
    return "fertility";
  }
  if (
    /ejercic|entren|fitness|workout|gym|muscul|plan de ejercicios|training plan/.test(
      text,
    )
  ) {
    return "fitness";
  }
  if (/motivacional|motivational|coaching motiv|coach/.test(text)) {
    return "coaching";
  }
  return "generic";
}

export function ageForKind(kind: OfferKind): number {
  if (kind === "fertility") return 29 + Math.floor(Math.random() * 13);
  if (kind === "fitness") return 24 + Math.floor(Math.random() * 26);
  return 27 + Math.floor(Math.random() * 24);
}

const es: LocalePools = {
  people: [
    { name: "María", gender: "f" },
    { name: "Lucía", gender: "f" },
    { name: "Valentina", gender: "f" },
    { name: "Camila", gender: "f" },
    { name: "Sofía", gender: "f" },
    { name: "Daniela", gender: "f" },
    { name: "Andrea", gender: "f" },
    { name: "Paula", gender: "f" },
    { name: "Carolina", gender: "f" },
    { name: "Fernanda", gender: "f" },
    { name: "Alejandra", gender: "f" },
    { name: "Natalia", gender: "f" },
    { name: "Elena", gender: "f" },
    { name: "Gabriela", gender: "f" },
    { name: "Isabel", gender: "f" },
    { name: "Carlos", gender: "m" },
    { name: "Andrés", gender: "m" },
    { name: "Diego", gender: "m" },
    { name: "Mateo", gender: "m" },
    { name: "Santiago", gender: "m" },
    { name: "Felipe", gender: "m" },
    { name: "Javier", gender: "m" },
    { name: "Ricardo", gender: "m" },
    { name: "Tomás", gender: "m" },
    { name: "Nicolás", gender: "m" },
    { name: "Miguel", gender: "m" },
    { name: "Sebastián", gender: "m" },
    { name: "Pablo", gender: "m" },
    { name: "Ignacio", gender: "m" },
    { name: "Luis", gender: "m" },
  ],
  locations: [
    "Ciudad de México",
    "Guadalajara",
    "Monterrey",
    "Bogotá",
    "Medellín",
    "Cali",
    "Buenos Aires",
    "Córdoba",
    "Lima",
    "Quito",
    "Santiago",
    "Madrid",
    "Barcelona",
    "Valencia",
    "Miami",
    "Montevideo",
    "Panamá",
  ],
  occupations: {
    easy: [
      "Gerente comercial",
      "Médica en clínica privada",
      "Directora de un área en una empresa",
      "Abogada con despacho propio",
      "Dueña de un negocio que ya factura",
      "Ingeniera senior en tech",
      "Consultora independiente establecida",
      "Odontóloga",
    ],
    medium: [
      "Contadora",
      "Coordinadora de RRHH",
      "Arquitecta independiente",
      "Ejecutiva de ventas",
      "Docente universitaria",
      "Analista financiera",
      "Dueña de un café",
      "Terapeuta",
      "Fotógrafa freelance",
      "Jefa de un equipo chico",
    ],
    hard: [
      "Maestra de primaria",
      "Administrativa en una oficina",
      "Emprendedora que recién empieza",
      "Freelance con ingresos irregulares",
      "Empleada de retail",
      "Enfermera de turno",
      "Recepcionista",
      "Vendedora independiente",
      "Estudiante de posgrado que trabaja",
    ],
  },
  awareness: {
    easy: [
      "Vi la página, leí los planes y agendé para confirmar que es para mí y arrancar.",
      "Llené el formulario; sé qué incluye a grandes rasgos y vengo con ganas de decidir.",
      "Me lo recomendaron y ya revisé de qué se trata. No necesito que me expliquen la categoría.",
    ],
    medium: [
      "Llené el formulario y vi que hay varios planes. Sé de qué va, quiero ver si encaja en mi caso.",
      "Llegué por un anuncio, leí lo esencial y agendé. Tengo contexto, no estoy vendida.",
      "Vi historias / la página. Entiendo el tipo de programa; vengo a resolver dudas y a que me califiquen.",
    ],
    hard: [
      "Vi la página y agendé para entender bien. Sé de qué va el tema, no estoy convencida de que sea para mí.",
      "Llené el formulario más por curiosidad calificada que por urgencia. Conozco la oferta a grandes rasgos.",
      "Me inscribí a la reunión porque el tema me toca. Sé qué venden; no sé si voy a comprar.",
    ],
  },
  timeline: {
    easy: [
      "Quiero empezar este mes o el que viene",
      "Busco resultados en 60–90 días",
      "Ya lo decidí en mi cabeza; vengo a aterrizar el plan",
    ],
    medium: [
      "Me gustaría en 1–3 meses, según cómo cierre el mes",
      "Hay una ventana, pero puedo posponerlo",
      "Quiero moverme pronto, no mañana mismo",
    ],
    hard: [
      "No tengo prisa; quiero evaluar",
      "Tal vez en unos meses, si acaso",
      "Estoy explorando, no en modo decidir hoy",
    ],
  },
  budget: {
    easy: [
      "Tengo presupuesto para el plan de entrada si veo que es para mí",
      "Puedo invertir en el rango de miles si el plan es claro",
      "El dinero no es el freno; quiero asegurarme del encaje",
    ],
    medium: [
      "Puedo estirarme con cuotas",
      "Depende del plan: el de entrada tal vez, el alto no sé",
      "Hay presupuesto, pero este mes está justo",
    ],
    hard: [
      "Pensé que iba a ser menos de USD 1,500",
      "Hoy el precio es el freno principal",
      "Tendría que mover otras cosas para pagarlo",
    ],
  },
  decisionMaker: {
    easy: [
      "Yo decido",
      "Mi pareja ya está de acuerdo; decido yo",
      "Decido sola y puedo pagar sin consultar",
    ],
    medium: [
      "Yo decido, pero le cuento a mi pareja",
      "Consulto a mi pareja antes de pagar",
      "Decido yo si el plan de entrada; uno más alto lo hablo",
    ],
    hard: [
      "No decido sola: mi pareja tiene que estar de acuerdo",
      "El dinero no sale sin hablarlo en casa",
      "Hay otra persona que frena cualquier inversión de este tamaño",
    ],
  },
  urgency: {
    easy: [
      "Esto ya me está costando en la vida diaria y quiero cortarlo ahora",
      "Tengo una fecha mental cercana y no quiero seguir improvisando",
      "Estoy lista para comprometerme si el plan es concreto",
    ],
    medium: [
      "Sé que debería actuar y llevo semanas dándole vueltas",
      "Me urge, pero también me frena el costo y el tiempo",
      "Hay presión interna, no una crisis de esta semana",
    ],
    hard: [
      "Llevo meses posponiéndolo y desconfío del timing",
      "Duele, pero no siento que tenga que ser ahora",
      "Puedo seguir como estoy un tiempo más",
    ],
  },
  pastAttempts: {
    easy: [
      "Probé por mi cuenta (YouTube, dietas, apps) y se me desarma",
      "Hice cosas sueltas; nunca un proceso con seguimiento",
      "Leí y consulté, pero no tuve un plan que alguien me exigiera",
    ],
    medium: [
      "Compré algo hace un año y no lo terminé",
      "Ya pagué un programa que prometía mucho y entregó poco",
      "Empecé con un profesional y lo dejé a las pocas semanas",
    ],
    hard: [
      "Ya me quemaron con algo parecido y desconfío",
      "Probé dos enfoques y ninguno se sostuvo",
      "Gasté dinero y tiempo y sigo en el mismo punto",
    ],
  },
  partner: {
    easy: [
      "Mi pareja apoya y no va a ser un tema",
      "Estoy soltera/o en la práctica de esta decisión; decido yo",
      "Ya hablamos y hay luz verde si el plan es serio",
    ],
    medium: [
      "Mi pareja apoya si ve números y qué incluye",
      "Lo va a cuestionar, pero no es un no automático",
      "Prefiero llegar a casa con algo concreto para mostrarle",
    ],
    hard: [
      "Mi pareja es escéptica y cuestiona cualquier inversión",
      "En casa esto se ve como un gasto, no como una inversión",
      "Si no convenzo a mi pareja, no avanza",
    ],
  },
  money: {
    easy: [
      "Puedo pagar el plan de entrada sin desarmar el mes",
      "Tengo el dinero; quiero ver que vale la pena",
      "Prefiero un pago único si hay claridad",
    ],
    medium: [
      "Necesito cuotas para que entre",
      "Puedo, pero me duele; quiero ROI claro o un plan que yo pueda sostener",
      "Este mes vs el que viene cambia la decisión",
    ],
    hard: [
      "Tengo ingresos irregulares y debo priorizar",
      "USD 1,500 me obliga a recortar otras cosas",
      "No quiero endeudarme por esto",
    ],
  },
  time: {
    easy: [
      "Puedo bloquear 3–5 horas por semana",
      "Mi agenda está llena, pero esto es prioridad y lo acomodo",
      "Mañanas o noches, tengo un hueco real",
    ],
    medium: [
      "Tengo tiempo limitado entre semana",
      "Puedo, si el plan es realista con mi trabajo",
      "Fines de semana sí; entre semana regular",
    ],
    hard: [
      "Trabajo muchas horas; encajar esto es complicado",
      "Con turnos / hijos / negocio, no veo de dónde sacar tiempo",
      "El tiempo es tan freno como el dinero",
    ],
  },
  objections: {
    easy: [
      ["¿Cuál plan me recomiendas para mi caso?", "¿Hay garantía o qué pasa si no puedo seguir?"],
      ["Quiero entender la diferencia entre el plan de entrada y el de en medio", "¿Cuándo empezarían?"],
      ["Necesito pensarlo esta noche, no meses", "¿Qué pasa si viajo dos semanas?"],
    ],
    medium: [
      ["Es un ticket alto para mí ahora", "Tengo que hablarlo con mi pareja", "¿Y si no funciona?"],
      ["¿Por qué no un plan más barato o hacerlo yo?", "El tiempo entre semana está justo"],
      ["Quiero comparar con otra opción que estoy viendo", "Las cuotas importan"],
    ],
    hard: [
      ["Ya me quemaron con algo parecido", "No creo que funcione para mi caso", "Prefiero esperar unos meses"],
      ["Pensé que era más barato", "Mi pareja no va a aceptar este número", "No tengo tiempo real"],
      ["Estoy cotizando tres cosas a la vez", "Hoy no decido", "Esto suena igual a lo que ya falló"],
    ],
  },
  personality: {
    easy: {
      f: [
        "Cálida, habla en concreto, colabora si le preguntan bien",
        "Directa pero amable; quiere decidir, no dar vueltas",
        "Abierta, comparte contexto personal sin que la arranquen",
      ],
      m: [
        "Cálido, habla en concreto, colabora si le preguntan bien",
        "Directo pero amable; quiere decidir, no dar vueltas",
        "Abierto, comparte contexto personal sin que lo arranquen",
      ],
    },
    medium: {
      f: [
        "Educada y un poco reservada; hay que indagar para el dolor real",
        "Mide las palabras; se abre si siente que la escuchan",
        "Comparte hechos, no emociones, hasta la tercera pregunta buena",
      ],
      m: [
        "Educado y un poco reservado; hay que indagar para el dolor real",
        "Mide las palabras; se abre si siente que lo escuchan",
        "Comparte hechos, no emociones, hasta la tercera pregunta buena",
      ],
    },
    hard: {
      f: [
        "Directa, escéptica, respuestas cortas hasta que hay confianza",
        "Cortante sin ser grosera; prueba si el closer improvisó",
        "Desconfiada por experiencias previas; no regala el cierre",
      ],
      m: [
        "Directo, escéptico, respuestas cortas hasta que hay confianza",
        "Cortante sin ser grosero; prueba si el closer improvisó",
        "Desconfiado por experiencias previas; no regala el cierre",
      ],
    },
  },
  qualificationSummary: {
    easy: [
      "Alta: presupuesto para el plan de entrada, decide, timeline corto, ya tiene contexto del producto.",
      "Alta: vino a confirmar encaje y avanzar. El dinero no es el drama; el fit sí.",
      "Alta: calificada y colaborativa. Objeciones suaves (plan, garantía, arranque).",
    ],
    medium: [
      "Mixta: hay interés real y un hueco (cuotas, pareja o tiempo). Hay que calificar.",
      "Mixta: conoce el producto, no está perdida, tampoco vendida.",
      "Mixta: podría comprar el plan de entrada si anclan su caso; el plan alto se le sube.",
    ],
    hard: [
      "Baja: tiene contexto del producto, pero poco presupuesto, poco apuro o no decide sola.",
      "Baja / escéptica: agendó, sabe de qué va, no está lista. Puede ser mal fit.",
      "Baja: dolor real, calificación floja. No facilitar el cierre.",
    ],
  },
  genericPains: (product) => [
    `Siento que ${product} podría ayudarme, pero no estoy segura de que sea para mi caso`,
    "He invertido antes y no se sostuvo",
    "Me cuesta la consistencia cuando nadie me pide cuentas",
    "No tengo claridad del siguiente paso concreto",
    "Improviso y me canso de empezar de cero cada vez",
  ],
  genericDesire: (product) => [
    `Quiero un proceso claro con ${product}, no más teoría`,
    "Quiero resultados que se noten en 60–90 días",
    "Quiero que alguien me sostenga para no abandonar",
  ],
  genericGoal: (product) => [
    `Avanzar de verdad con ${product} en los próximos meses`,
    "Dejar de improvisar y tener un plan",
    "Ver si este programa es el que me falta",
  ],
  offerPains: {
    fertility: [
      "Llevo más de un año intentando y los estudios 'salen bien'",
      "El médico dijo 'sigue intentando' y me siento en el limbo",
      "Tengo más de 35 y siento que el tiempo aprieta",
      "Mi alimentación y el estrés están desordenados y lo sé",
      "Empecé dietas y suplementos sueltos y no sostuve nada",
      "Con mi pareja no estamos alineados en el enfoque",
      "Me da miedo invertir y que sea 'otra cosa más'",
    ],
    coaching: [
      "Empiezo con todo y a las tres semanas se me cae",
      "Sé lo que tengo que hacer y no lo hago",
      "Estoy estancada en trabajo o negocio y me frustro",
      "Me falta alguien que me pida cuentas de verdad",
      "Consumo contenido y no ejecuto",
      "Cambio de prioridad cada mes y no termino nada",
    ],
    fitness: [
      "Entreno y no veo cambio desde hace meses",
      "Copié rutinas de Instagram y me molestó una articulación",
      "Empiezo en enero y en marzo desaparezco",
      "No sé cómo progresar cargas ni qué hacer los días que viajo",
      "El gimnasio se me volvió automático y aburrido",
      "Quiero un plan para MI tiempo, no uno genérico de 6 días",
    ],
  },
  offerDesire: {
    fertility: [
      "Quiero concebir y sentir que mi cuerpo y mis hábitos están de mi lado",
      "Quiero un protocolo, no más tips sueltos",
      "Quiero que mi pareja y yo rememos para el mismo lado",
    ],
    coaching: [
      "Quiero consistencia y un rumbo, no otro subidón de motivación",
      "Quiero ejecutar lo que ya sé",
      "Quiero que en 12 semanas se note que no soy la misma",
    ],
    fitness: [
      "Quiero un plan que pueda sostener y ver fuerza o composición real",
      "Quiero entrenar sin lesionarme y sin adivinar",
      "Quiero que alguien corrija y progrese el programa por mí",
    ],
  },
  offerGoal: {
    fertility: [
      "Ordenar nutrición, sueño y estrés para concebir en los próximos meses",
      "Tener un plan de fertilidad (hábitos) que yo pueda seguir",
      "Ver si este acompañamiento es el que nos faltaba como pareja",
    ],
    coaching: [
      "Sostener hábitos y decisiones 8–12 semanas sin abandonar",
      "Salir del estancamiento con un proceso 1:1",
      "Elegir un plan de coaching y comprometerse",
    ],
    fitness: [
      "Tener un programa a medida y cumplirlo 8–12 semanas",
      "Dejar las rutinas genéricas y progresar de verdad",
      "Entrenar con un plan que entre en mi semana real",
    ],
  },
};

function translateBase(
  people: NamedPerson[],
  locations: string[],
  rest: Omit<LocalePools, "people" | "locations">,
): LocalePools {
  return { people, locations, ...rest };
}

const en: LocalePools = translateBase(
  [
    { name: "Sarah", gender: "f" },
    { name: "Emily", gender: "f" },
    { name: "Jessica", gender: "f" },
    { name: "Amanda", gender: "f" },
    { name: "Lauren", gender: "f" },
    { name: "Nicole", gender: "f" },
    { name: "Rachel", gender: "f" },
    { name: "Megan", gender: "f" },
    { name: "Olivia", gender: "f" },
    { name: "Hannah", gender: "f" },
    { name: "James", gender: "m" },
    { name: "Michael", gender: "m" },
    { name: "David", gender: "m" },
    { name: "Daniel", gender: "m" },
    { name: "Chris", gender: "m" },
    { name: "Ryan", gender: "m" },
    { name: "Alex", gender: "m" },
    { name: "Andrew", gender: "m" },
    { name: "Kevin", gender: "m" },
    { name: "Brian", gender: "m" },
  ],
  [
    "New York",
    "Miami",
    "Los Angeles",
    "Austin",
    "Chicago",
    "London",
    "Toronto",
    "Dublin",
    "Sydney",
  ],
  {
    occupations: {
      easy: [
        "Sales director",
        "Physician in private practice",
        "Senior software engineer",
        "Business owner",
        "Attorney with her own firm",
        "Independent consultant",
      ],
      medium: [
        "Accountant",
        "HR coordinator",
        "Account executive",
        "Freelance designer",
        "University lecturer",
        "Small café owner",
      ],
      hard: [
        "Elementary teacher",
        "Office administrator",
        "Retail employee",
        "Nurse on shifts",
        "Freelance with uneven income",
        "Graduate student who also works",
      ],
    },
    awareness: {
      easy: [
        "I read the page, saw the plans, and booked to confirm fit and start.",
        "I filled the form. I know what this is; I'm here to decide.",
      ],
      medium: [
        "I filled the form and I know there are a few plans. I want to see if it fits.",
        "I came from an ad, read the gist, and booked. I have context; I'm not sold.",
      ],
      hard: [
        "I booked to understand it better. I know what you sell; I'm not convinced it's for me.",
        "I know the category. I showed up. I may not buy.",
      ],
    },
    timeline: {
      easy: ["I want to start this month or next", "I'm aiming at 60–90 days"],
      medium: ["1–3 months, depending on cash flow", "Soon, not necessarily today"],
      hard: ["No rush, I want to evaluate", "Maybe in a few months"],
    },
    budget: {
      easy: [
        "I can do the entry plan if it's a fit",
        "Money isn't the blocker; fit is",
      ],
      medium: [
        "Installments would help",
        "Entry plan maybe; the top plan I'm not sure",
      ],
      hard: [
        "I thought it would be under USD 1,500",
        "Price is the main blocker right now",
      ],
    },
    decisionMaker: {
      easy: ["I decide", "My partner already agrees"],
      medium: ["I decide but I'll run it by my partner", "I consult before paying"],
      hard: ["I don't decide alone", "Nothing this size moves without a conversation at home"],
    },
    urgency: {
      easy: ["This is costing me daily and I want to cut it now"],
      medium: ["I should act; I've been circling for weeks"],
      hard: ["It hurts but it doesn't have to be now"],
    },
    pastAttempts: {
      easy: ["I tried DIY and it falls apart"],
      medium: ["I bought a program last year and didn't finish"],
      hard: ["I've been burned by something similar"],
    },
    partner: {
      easy: ["Partner is on board", "This decision is mine"],
      medium: ["Partner supports if the numbers are clear"],
      hard: ["Partner is skeptical of any spend like this"],
    },
    money: {
      easy: ["I can pay the entry plan without wrecking the month"],
      medium: ["I need a payment plan for it to fit"],
      hard: ["Income is uneven; USD 1,500 means cutting other things"],
    },
    time: {
      easy: ["I can block 3–5 hours a week"],
      medium: ["Weekdays are tight; weekends are possible"],
      hard: ["Long hours / kids / shifts — time is a real blocker"],
    },
    objections: {
      easy: [
        ["Which plan fits my case?", "Is there a guarantee?"],
        ["What's the difference between the first two plans?"],
      ],
      medium: [
        ["It's a lot right now", "I need to talk to my partner", "What if it doesn't work?"],
      ],
      hard: [
        ["I've been burned", "I don't think this works for my case", "I'd rather wait"],
      ],
    },
    personality: {
      easy: {
        f: ["Warm, concrete, collaborative"],
        m: ["Warm, concrete, collaborative"],
      },
      medium: {
        f: ["Polite, a bit reserved; needs good probing"],
        m: ["Polite, a bit reserved; needs good probing"],
      },
      hard: {
        f: ["Direct, skeptical, short answers until trust"],
        m: ["Direct, skeptical, short answers until trust"],
      },
    },
    qualificationSummary: {
      easy: ["High: budget, decides, short timeline, knows the offer."],
      medium: ["Mixed: real interest plus a gap (money, partner, or time)."],
      hard: ["Low: has product context, not ready. May be a poor fit."],
    },
    genericPains: (product) => [
      `I think ${product} could help but I'm not sure it's for my case`,
      "I've paid for things that didn't stick",
      "I can't stay consistent without accountability",
    ],
    genericDesire: (product) => [
      `I want a real process with ${product}, not more theory`,
    ],
    genericGoal: (product) => [`See if ${product} is the missing piece and move`],
    offerPains: {
      fertility: [
        "We've been trying over a year and labs 'look fine'",
        "Doctor said keep trying and I feel stuck",
        "I'm over 35 and time feels loud",
      ],
      coaching: [
        "I start strong and drop off in three weeks",
        "I know what to do and I don't do it",
      ],
      fitness: [
        "I train and nothing has changed in months",
        "I copied Instagram programs and irritated a joint",
      ],
    },
    offerDesire: {
      fertility: ["I want to conceive with habits that actually support me"],
      coaching: ["I want consistency, not another motivation spike"],
      fitness: ["I want a plan I can keep and actual progress"],
    },
    offerGoal: {
      fertility: ["Get nutrition, sleep, and stress in order for conception"],
      coaching: ["Hold habits for 8–12 weeks with 1:1 support"],
      fitness: ["Follow a custom program for 8–12 weeks"],
    },
  },
);

const pt: LocalePools = translateBase(
  [
    { name: "Ana", gender: "f" },
    { name: "Juliana", gender: "f" },
    { name: "Camila", gender: "f" },
    { name: "Beatriz", gender: "f" },
    { name: "Mariana", gender: "f" },
    { name: "Fernanda", gender: "f" },
    { name: "Larissa", gender: "f" },
    { name: "Pedro", gender: "m" },
    { name: "Rafael", gender: "m" },
    { name: "Lucas", gender: "m" },
    { name: "Thiago", gender: "m" },
    { name: "Bruno", gender: "m" },
    { name: "Gabriel", gender: "m" },
    { name: "Felipe", gender: "m" },
  ],
  ["São Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba", "Lisboa", "Porto"],
  {
    occupations: {
      easy: [
        "Gerente comercial",
        "Médica em clínica",
        "Dona de negócio estabelecido",
        "Advogada com escritório",
      ],
      medium: [
        "Contadora",
        "Coordenadora de RH",
        "Executiva de vendas",
        "Arquiteta autônoma",
      ],
      hard: [
        "Professora",
        "Administrativa",
        "Freelancer com renda irregular",
        "Enfermeira de plantão",
      ],
    },
    awareness: {
      easy: ["Li a página, vi os planos e agendei para confirmar e começar."],
      medium: ["Preenchi o formulário. Sei do que se trata; quero ver se encaixa."],
      hard: ["Agendei para entender. Sei o que vendem; não estou convencida."],
    },
    timeline: {
      easy: ["Quero começar este mês ou no próximo"],
      medium: ["1–3 meses, conforme o caixa"],
      hard: ["Sem pressa; quero avaliar"],
    },
    budget: {
      easy: ["Tenho orçamento para o plano de entrada se fizer sentido"],
      medium: ["Parcelas ajudam"],
      hard: ["Achei que seria menos de USD 1.500"],
    },
    decisionMaker: {
      easy: ["Eu decido"],
      medium: ["Eu decido, mas falo com meu parceiro"],
      hard: ["Não decido sozinha"],
    },
    urgency: {
      easy: ["Isso já me custa no dia a dia"],
      medium: ["Sei que deveria agir e venho adiando"],
      hard: ["Dói, mas não precisa ser agora"],
    },
    pastAttempts: {
      easy: ["Tentei sozinha e desmonto"],
      medium: ["Comprei um programa e não terminei"],
      hard: ["Já me queimei com algo parecido"],
    },
    partner: {
      easy: ["Meu parceiro apoia"],
      medium: ["Apoia se vir números claros"],
      hard: ["É cético com qualquer investimento assim"],
    },
    money: {
      easy: ["Consigo pagar o plano de entrada"],
      medium: ["Preciso parcelar"],
      hard: ["Renda irregular; USD 1.500 aperta"],
    },
    time: {
      easy: ["Consigo 3–5 horas por semana"],
      medium: ["Semana apertada"],
      hard: ["Turnos / filhos / trabalho — tempo é travamento"],
    },
    objections: {
      easy: [["Qual plano é o meu?", "Tem garantia?"]],
      medium: [["Está caro agora", "Preciso falar em casa", "E se não funcionar?"]],
      hard: [["Já me queimei", "Não acho que sirva no meu caso", "Prefiro esperar"]],
    },
    personality: {
      easy: { f: ["Colaborativa, concreta"], m: ["Colaborativo, concreto"] },
      medium: { f: ["Educada, um pouco reservada"], m: ["Educado, um pouco reservado"] },
      hard: { f: ["Direta e cética"], m: ["Direto e cético"] },
    },
    qualificationSummary: {
      easy: ["Alta: orçamento, decide, prazo curto, conhece a oferta."],
      medium: ["Mista: interesse real e uma lacuna."],
      hard: ["Baixa: tem contexto do produto, não está pronta."],
    },
    genericPains: (p) => [`Acho que ${p} ajudaria, mas não tenho certeza`],
    genericDesire: (p) => [`Quero um processo claro com ${p}`],
    genericGoal: (p) => [`Avançar com ${p} nos próximos meses`],
    offerPains: {
      fertility: ["Tentamos há mais de um ano e os exames 'estão bem'"],
      coaching: ["Começo bem e em três semanas desisto"],
      fitness: ["Treino e não muda nada há meses"],
    },
    offerDesire: {
      fertility: ["Quero conceber com hábitos que me sustentem"],
      coaching: ["Quero consistência, não outro pico de motivação"],
      fitness: ["Quero um plano que eu consiga cumprir"],
    },
    offerGoal: {
      fertility: ["Organizar nutrição e estresse para conceber"],
      coaching: ["Sustentar hábitos por 8–12 semanas"],
      fitness: ["Seguir um programa sob medida"],
    },
  },
);

const fr: LocalePools = translateBase(
  [
    { name: "Marie", gender: "f" },
    { name: "Sophie", gender: "f" },
    { name: "Camille", gender: "f" },
    { name: "Léa", gender: "f" },
    { name: "Claire", gender: "f" },
    { name: "Emma", gender: "f" },
    { name: "Pierre", gender: "m" },
    { name: "Thomas", gender: "m" },
    { name: "Lucas", gender: "m" },
    { name: "Nicolas", gender: "m" },
    { name: "Antoine", gender: "m" },
    { name: "Julien", gender: "m" },
  ],
  ["Paris", "Lyon", "Montréal", "Bruxelles", "Genève", "Bordeaux"],
  {
    occupations: {
      easy: [
        "Directrice commerciale",
        "Médecin en cabinet",
        "Ingénieure senior",
        "Avocate à son compte",
      ],
      medium: [
        "Comptable",
        "Responsable RH",
        "Architecte indépendante",
        "Commerciale",
      ],
      hard: [
        "Enseignante",
        "Assistante administrative",
        "Freelance aux revenus irréguliers",
        "Infirmière en horaires décalés",
      ],
    },
    awareness: {
      easy: ["J'ai lu la page, vu les formules, et pris RDV pour confirmer et démarrer."],
      medium: ["J'ai rempli le formulaire. Je vois de quoi il s'agit; je veux voir si ça me correspond."],
      hard: ["J'ai pris RDV pour comprendre. Je sais ce que vous vendez; je ne suis pas convaincue."],
    },
    timeline: {
      easy: ["Je veux commencer ce mois-ci ou le suivant"],
      medium: ["1–3 mois, selon la trésorerie"],
      hard: ["Pas pressée; je veux évaluer"],
    },
    budget: {
      easy: ["J'ai le budget de l'offre d'entrée si c'est le bon fit"],
      medium: ["Un paiement en plusieurs fois aiderait"],
      hard: ["Je pensais que c'était sous 1 500 USD"],
    },
    decisionMaker: {
      easy: ["Je décide"],
      medium: ["Je décide mais j'en parle à mon partenaire"],
      hard: ["Je ne décide pas seule"],
    },
    urgency: {
      easy: ["Ça me coûte déjà au quotidien"],
      medium: ["Je sais que je devrais agir, je tourne autour"],
      hard: ["Ça fait mal, mais ça n'a pas à être maintenant"],
    },
    pastAttempts: {
      easy: ["J'ai essayé seule et ça ne tient pas"],
      medium: ["J'ai acheté un programme et je n'ai pas fini"],
      hard: ["Je me suis déjà fait avoir avec quelque chose de similaire"],
    },
    partner: {
      easy: ["Mon partenaire est aligné"],
      medium: ["Il/elle veut voir les chiffres"],
      hard: ["Sceptique sur toute dépense de ce type"],
    },
    money: {
      easy: ["Je peux payer l'offre d'entrée"],
      medium: ["J'ai besoin de facilité de paiement"],
      hard: ["Revenus irréguliers; 1 500 USD serre"],
    },
    time: {
      easy: ["Je peux bloquer 3–5 h par semaine"],
      medium: ["Semaine chargée"],
      hard: ["Horaires / enfants — le temps bloque autant que l'argent"],
    },
    objections: {
      easy: [["Quelle formule pour mon cas ?", "Y a-t-il une garantie ?"]],
      medium: [["C'est cher là", "Je dois en parler à la maison", "Et si ça ne marche pas ?"]],
      hard: [["Je me suis déjà fait avoir", "Pas sûr que ça marche pour moi", "Je préfère attendre"]],
    },
    personality: {
      easy: { f: ["Collaborative, concrète"], m: ["Collaboratif, concret"] },
      medium: { f: ["Polie, un peu réservée"], m: ["Poli, un peu réservé"] },
      hard: { f: ["Directe et sceptique"], m: ["Direct et sceptique"] },
    },
    qualificationSummary: {
      easy: ["Haute : budget, décide, délai court, connaît l'offre."],
      medium: ["Mixte : vrai intérêt plus un trou (argent, couple ou temps)."],
      hard: ["Basse : a le contexte produit, n'est pas prête."],
    },
    genericPains: (p) => [`Je sens que ${p} pourrait aider, sans être sûre que ce soit pour moi`],
    genericDesire: (p) => [`Je veux un vrai process avec ${p}`],
    genericGoal: (p) => [`Avancer avec ${p} dans les prochains mois`],
    offerPains: {
      fertility: ["On essaie depuis plus d'un an et les examens sont 'normaux'"],
      coaching: ["Je démarre fort et j'abandonne à trois semaines"],
      fitness: ["Je m'entraîne et rien n'a changé depuis des mois"],
    },
    offerDesire: {
      fertility: ["Concevoir avec des habitudes qui me soutiennent"],
      coaching: ["De la constance, pas un nouveau pic de motivation"],
      fitness: ["Un plan tenable et des progrès réels"],
    },
    offerGoal: {
      fertility: ["Mettre nutrition et stress en ordre pour concevoir"],
      coaching: ["Tenir 8–12 semaines en 1:1"],
      fitness: ["Suivre un programme sur mesure"],
    },
  },
);

export const PROSPECT_POOLS: Record<LanguageCode, LocalePools> = {
  es,
  en,
  pt,
  fr,
};
