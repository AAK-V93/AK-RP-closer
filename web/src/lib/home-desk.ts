import { closerSpanish } from "@/lib/closer-spanish";

export function analyzeCardStatus(unclassified: number) {
  if (unclassified > 0) return `${unclassified} sin clasificar`;
  return "Todo al día";
}

export function followupCardStatus(today: number, overdue: number) {
  const dueToday = Math.max(0, today);
  const late = Math.max(0, overdue);
  if (dueToday <= 0 && late <= 0) return "Todo al día";
  if (dueToday <= 0) return late === 1 ? "1 atrasado" : `${late} atrasados`;
  if (late <= 0) return dueToday === 1 ? "1 pendiente de hoy" : `${dueToday} pendientes de hoy`;
  return `${dueToday} pendiente${dueToday === 1 ? "" : "s"} de hoy · ${late} atrasado${late === 1 ? "" : "s"}`;
}

export function coachCardStatus(args: {
  newPattern: boolean;
  analyzedThisWeek: number;
}) {
  if (args.newPattern) return "Nuevo patrón detectado";
  if (args.analyzedThisWeek > 0) {
    const n = args.analyzedThisWeek;
    return `${n} llamada${n === 1 ? "" : "s"} analizada${n === 1 ? "" : "s"} esta semana`;
  }
  return "Sin novedades";
}

function foldPattern(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** A curriculum title or a coach instruction, not something the client says. */
function isExerciseTitle(value: string) {
  const text = foldPattern(value);
  return (
    /manejo efectivo|ejercicio|objecion de|reconoce|relaciona|devuelve la pregunta|como responder|entrenamiento|antes de cerrar|practica de|roleplay|rol play/.test(
      text,
    ) || /^(resolver|manejar|practicar|entrenar|reconocer|trabajar)\b/.test(text)
  );
}

/** First person, short, and not a stage label. */
function looksSpoken(value: string) {
  const text = foldPattern(value);
  if (isExerciseTitle(value) || value.length > 60) return false;
  if (/\b(necesita|cliente|objecion|ejercicio|manejo|closer)\b/.test(text)) return false;
  return /^(lo |la |no |ya |es |esta |tengo |necesito |quiero |puedo |me |voy |despues )/.test(text);
}

/**
 * Known objection labels become the short line a client actually says.
 * More specific patterns go first.
 */
const SPOKEN_PATTERNS: { test: RegExp; phrase: string }[] = [
  { test: /no tiene dinero|sin dinero|no tengo dinero/, phrase: "no tengo dinero" },
  { test: /consult/, phrase: "lo tengo que consultar" },
  { test: /pareja|espos/, phrase: "lo tengo que hablar con mi pareja" },
  { test: /socio/, phrase: "lo tengo que hablar con mi socio" },
  { test: /pensar|pensarlo|lo pienso/, phrase: "lo voy a pensar" },
  { test: /tiempo|ocupad/, phrase: "no tengo tiempo" },
  { test: /no es el momento|\bmomento\b/, phrase: "no es el momento" },
  { test: /mas informacion|no confia/, phrase: "necesito más información" },
  { test: /otra persona|ya compr/, phrase: "ya compré con otra persona" },
  { test: /precio|caro|plata/, phrase: "está muy caro" },
];

/** A client-like line. An exercise title is mapped or dropped, never quoted as-is. */
export function clientPatternPhrase(raw: string) {
  let clean = closerSpanish(String(raw || ""))
    .replace(/\s+/g, " ")
    .trim();
  if (/^pierdes cierres cuando te dicen\b/i.test(clean)) {
    clean = clean.replace(/^pierdes cierres cuando te dicen\s*/i, "");
  }
  clean = clean.replace(/^["“«']+|["”»']+$/g, "").trim();
  if (clean.length < 4) return "";
  if (looksSpoken(clean) && !isExerciseTitle(clean)) {
    return clean.charAt(0).toLocaleLowerCase("es") + clean.slice(1);
  }
  const folded = foldPattern(clean);
  for (const row of SPOKEN_PATTERNS) {
    if (row.test.test(folded)) return row.phrase;
  }
  return "";
}

/**
 * The line to show on the practice idle. A drill title is not quoted as something
 * the client said.
 */
export function spokenPracticeFocus(value: string) {
  const raw = String(value || "").trim();
  const phrase = clientPatternPhrase(raw);
  if (!phrase) return "";
  if (phrase === raw || phrase === raw.toLocaleLowerCase("es")) return phrase;
  return "";
}

/** «Pierdes cierres cuando te dicen “…”». The quote is a client line, never an exercise title. */
export function patternSentence(raw: string) {
  const phrase = clientPatternPhrase(raw);
  if (!phrase) return "";
  return `Pierdes cierres cuando te dicen “${phrase}”`;
}

/** First-paint fallback until the light practice endpoint returns a drill. */
export function practiceCardFromGuides(
  guides: { drills?: string[]; missingInLosses?: string[]; note?: string; ready?: boolean }[],
) {
  const drill = closerSpanish(
    guides.flatMap((guide) => guide.drills || []).find((item) => item.trim()) || "",
  ).trim();
  const loss = guides.flatMap((guide) => guide.missingInLosses || []).find((item) => item.trim()) || "";
  const phrase = clientPatternPhrase(loss);
  const pattern = patternSentence(loss);
  // The room starts on the line the client says. A drill is only the fallback.
  const focus = phrase || drill;
  return {
    practiceHref: focus ? `/practicar?focus=${encodeURIComponent(focus)}` : "/practicar",
    practiceStatus: drill || "Elige con quién practicar",
    /** The exercise the practice room focuses on. */
    drill,
    /** The sentence on «Lo que más te frena». Empty hides the card. */
    pattern,
    newPattern: guides.some((guide) => Boolean(guide.ready)),
  };
}
