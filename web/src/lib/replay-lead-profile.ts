import type { DifficultyLevel, ProspectProfile } from "@/data/training-session";
import { QUALIFICATION_BY_DIFFICULTY } from "@/data/prospect-pools";
import {
  typesFromPlaybook,
  type LeadPlaybook,
  type TalkStyle,
} from "@/lib/lead-playbook";
import type { ReplayCall, ReplayFiling } from "@/lib/replay-call";

function unique(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = String(item || "").replace(/\s+/g, " ").trim();
    const key = value.toLowerCase();
    if (value.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function firstSentence(text: string, maxWords = 18) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentence = clean.split(/(?<=[.!?;])\s/)[0] || clean;
  const words = sentence.split(" ");
  return words.length > maxWords
    ? `${words.slice(0, maxWords).join(" ")}…`
    : sentence;
}

function blobOf(replay: ReplayCall) {
  const filing = replay.filing;
  return [
    replay.excerpt,
    replay.summary,
    replay.leadLines.join(" "),
    filing?.notasCrm,
    filing?.razonNoCierre,
    replay.objections,
    replay.title,
  ]
    .filter(Boolean)
    .join("\n");
}

function matchGroup(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return (match?.[1] || match?.[0] || "").trim();
}

function inferBusiness(text: string) {
  return (
    matchGroup(
      text,
      /(?:tengo|tenemos|mi|nuestro)\s+(negocio|empresa|local|consultorio|clínica|clinica|agencia|equipo|tienda|restaurante|gimnasio|despacho)(?:\s+de\s+[^.,;]{3,40})?/i,
    ) ||
    matchGroup(
      text,
      /\b(?:soy|somos)\s+(?:el |la )?(dueñ[oa]|ceo|director[a]?|gerente|emprendedor[a]?|independiente)(?:\s+de\s+[^.,;]{3,40})?/i,
    )
  );
}

function inferPain(text: string, lines: string[]) {
  const fromLine = lines.find((line) =>
    /no me alcanza|estancad|no cierra|no vendo|caro|miedo|cansad|atrasad|no tengo tiempo|no funciona|me cuesta/i.test(
      line,
    ),
  );
  if (fromLine) return firstSentence(fromLine, 16);
  return firstSentence(
    matchGroup(
      text,
      /(?:el problema|lo que me mata|estoy|estamos|no logro|no puedo|me cuesta)[^.]{8,80}/i,
    ),
    16,
  );
}

function inferDecidesWith(text: string) {
  const consult = matchGroup(
    text,
    /(?:hablarlo|hablarlo?|consultarlo|decirlo|comentarlo|preguntarle|verlo|hablar)\s+(?:con|a)\s+(?:mi |el |la )?([a-záéíóúñü ]{2,28})/i,
  );
  if (consult) return consult.replace(/\b(después|luego|ahora|primero)\b/gi, "").trim();
  const role = matchGroup(
    text,
    /\b(mi esposa|mi esposo|mi mujer|mi marido|mi socio|mi socia|mi pareja|mi junta|mi contador|el dueño|la dueña)\b/i,
  );
  return role;
}

function inferTalkStyle(lines: string[]): TalkStyle {
  if (!lines.length) return "rambler";
  const avg =
    lines.reduce((sum, line) => sum + line.split(/\s+/).length, 0) / lines.length;
  if (avg <= 7) return "terse";
  if (avg >= 22) return "storyteller";
  return "rambler";
}

function flavorPhrases(lines: string[]) {
  return unique(
    lines.filter(
      (line) =>
        line.length >= 8 &&
        line.length <= 90 &&
        !/^(ok+|sí|si|no|claro|aja|ajá|mm+|uh+|este|bueno)\b/i.test(line),
    ),
  ).slice(0, 3);
}

function objectionFromLine(line: string) {
  return /caro|precio|plata|dinero|pienso|pensar|después|socio|esposa|tiempo|ahora no|no estoy seguro|lo hablo|no es el momento|no me alcanza|otra opción/i.test(
    line,
  );
}

function playbookObjectionsInCall(blob: string, playbook: LeadPlaybook | null) {
  if (!playbook) return [];
  const lower = blob.toLowerCase();
  return unique(
    playbook.typicalObjections
      .filter((item) => {
        const quote = item.quote.toLowerCase();
        const root = item.root.toLowerCase();
        return (
          (quote.length > 8 && lower.includes(quote.slice(0, 22))) ||
          (root.length > 8 && lower.includes(root.slice(0, 22)))
        );
      })
      .map((item) => item.quote || item.root),
  );
}

function moneyFromFiling(filing: ReplayFiling | null | undefined) {
  if (!filing) return "";
  const bits = [
    filing.ventaTotal != null ? `hablaron de ${filing.ventaTotal}` : "",
    filing.cashCollected != null ? `cash ${filing.cashCollected}` : "",
    filing.saldoPendiente != null ? `saldo ${filing.saldoPendiente}` : "",
    filing.modoPago ? `pago ${filing.modoPago}` : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

export function buildReplayLeadProfile(args: {
  replay: ReplayCall;
  playbook?: LeadPlaybook | null;
  difficulty?: DifficultyLevel;
}): ProspectProfile {
  const { replay, playbook } = args;
  const difficulty = args.difficulty || "medium";
  const blob = blobOf(replay);
  const filing = replay.filing || null;
  const types = playbook ? typesFromPlaybook(playbook) : [];
  const matchedType =
    types.find((item) => {
      const name = item.name.toLowerCase().slice(0, 12);
      return name.length >= 4 && blob.toLowerCase().includes(name);
    }) || types[0] || null;

  const heldFromFiling = String(filing?.razonNoCierre || "").trim();
  const heldFromTag = replay.objections
    .split(/[|;,/]/)
    .map((item) => item.trim())
    .filter(Boolean)[0];
  const heldFromLines =
    replay.leadLines.find(objectionFromLine) || "";
  const fromPlaybook = playbookObjectionsInCall(blob, playbook);
  const held =
    heldFromFiling ||
    heldFromTag ||
    firstSentence(heldFromLines, 14) ||
    fromPlaybook[0] ||
    "lo voy a pensar";

  const situation =
    firstSentence(filing?.notasCrm || "", 18) ||
    firstSentence(replay.summary, 18) ||
    inferPain(blob, replay.leadLines) ||
    firstSentence(replay.title, 12);

  const business = inferBusiness(blob);
  const decidesWith = inferDecidesWith(blob);
  const money = moneyFromFiling(filing);
  const flavor = flavorPhrases(replay.leadLines);
  const talkStyle = matchedType?.talkStyle || inferTalkStyle(replay.leadLines);
  const extraObjections = unique([
    held,
    ...fromPlaybook.slice(0, 2),
    ...(playbook?.typicalObjections.slice(0, 2).map((item) => item.quote) || []),
  ]).filter((item) => item !== held).slice(0, 2);

  const personality = unique([
    matchedType?.howTheyExpress || "",
    flavor.length
      ? `Cómo habla (ritmo, no un guion): ${flavor.join(" / ")}`
      : playbook?.howLeadsTalk?.slice(0, 180) || "",
    business ? `Negocio: ${business}` : "",
  ]).join(" · ");

  return {
    name: replay.leadName || "Lead",
    age: 38,
    occupation: business || "dueño de su negocio",
    location: "",
    qualificationLevel: QUALIFICATION_BY_DIFFICULTY[difficulty],
    qualificationSummary:
      "Eres la misma persona de una llamada que NO cerró. Mismos hechos, misma resistencia. No eres un actor leyendo el transcript.",
    howTheyKnowTheOffer:
      "Ya tuvieron la reunión. Esto es el do-over de esa llamada, no un follow-up semanas después salvo que el closer lo encuadre así.",
    preQualification: {
      mainGoal: situation,
      currentSituation: situation,
      timeline: "",
      budgetRange: money,
      decisionMaker: decidesWith || "no quedó claro; no inventes un comité",
    },
    pains: situation ? [situation] : [],
    urgency: situation,
    desire: firstSentence(playbook?.buyingTriggers[0] || situation, 12),
    pastAttempts: "Ya hablaron y no cerró.",
    partnerSituation: decidesWith,
    moneySituation: money,
    timeSituation: "",
    objections: unique([held, ...extraObjections]),
    personalityNotes: personality,
    heldObjection: held,
    isRealLead: true,
    talkStyle,
    leadTypeName: matchedType?.name || "",
    noiseTopics: matchedType?.noiseTopics || [],
    heldRelevant: matchedType?.heldRelevant || [
      "dinero real",
      "quién decide",
      "dolor de fondo",
    ],
  };
}

export function replayCharacterInstructions(
  profile: ProspectProfile,
  replay: ReplayCall,
  playbook?: LeadPlaybook | null,
): string {
  const filing = replay.filing;
  const icp = playbook?.icp?.trim().slice(0, 400) || "";
  const frequent = unique(
    (playbook?.typicalObjections || []).map((item) =>
      [item.quote, item.root].filter(Boolean).join(" — "),
    ),
  ).slice(0, 5);
  const facts = unique([
    profile.pains[0] || profile.preQualification.currentSituation,
    profile.occupation ? `Negocio/ocupación: ${profile.occupation}` : "",
    profile.heldObjection ? `Por qué no cerró: ${profile.heldObjection}` : "",
    profile.partnerSituation
      ? `Decide con: ${profile.partnerSituation}`
      : "",
    profile.moneySituation ? `Montos: ${profile.moneySituation}` : "",
    filing?.notasCrm ? `Notas CRM: ${firstSentence(filing.notasCrm, 22)}` : "",
    filing?.etapaPerdida ? `Etapa: ${filing.etapaPerdida}` : "",
    replay.result ? `Resultado de aquella llamada: ${replay.result}` : "",
  ]);

  return `REPLAY. Eres ${profile.name}, un lead real. No eres un actor leyendo un guion.

Eres esta persona. Si te preguntan algo que no está en la llamada original, responde de forma consistente con tu perfil e improvisa como lo haría este lead. Nunca repitas una respuesta ya dada.

ANTI-LOOP: no reutilices frases que ya dijiste en esta sesión. Cada turno, formula la idea con otras palabras o avanza. Si el closer insiste en lo mismo, sostén la objeción con una formulación nueva, no con la misma oración.

El transcript es memoria privada de lo que ya viviste, NO un libreto. No copies líneas literales. No recites el excerpt.

## Perfil (personaje)
- Situación: ${profile.preQualification.currentSituation || "la de aquella llamada"}
- Negocio: ${profile.occupation}
- Dolor: ${profile.pains[0] || profile.heldObjection}
- Objeción que sostiene: ${profile.heldObjection}
- Cómo habla: ${profile.personalityNotes || profile.talkStyle || "natural"}
- Qué decide y con quién: ${profile.preQualification.decisionMaker || profile.partnerSituation || "no quedó claro; no inventes un comité"}

${icp ? `ICP de esta oferta (contexto, no tu biografía inventada): ${icp}` : ""}
${frequent.length ? `Objeciones frecuentes de compradores como tú (úsalas con tu voz SOLO si encajan con tu caso): ${frequent.join(" | ")}` : ""}

## Hechos privados (no los sueltes de golpe, no los recites)
${facts.map((item) => `- ${item}`).join("\n")}
Título de aquella llamada: ${replay.title}`;
}
