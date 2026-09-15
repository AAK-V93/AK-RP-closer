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
import {
  isPlaybookReady,
  typesFromPlaybook,
  type LeadPlaybook,
  type LeadPersona,
  type LeadType,
  type TalkStyle,
} from "@/lib/lead-playbook";
import type { ReplayCall } from "@/lib/replay-call";

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

function firstIdea(text: string, maxWords = 12) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const sentence = clean.split(/(?<=[.!?;])\s/)[0] || clean;
  const words = sentence.split(" ");
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}…` : sentence;
}

function uniqueStrings(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = String(item || "").trim();
    const key = value.toLowerCase();
    if (value.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
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
  const n = difficulty === "easy" ? 1 : 2;
  return pickN(pool, n).map((item) => firstIdea(item, 10));
}

function resolveType(
  playbook: LeadPlaybook | null | undefined,
  typeName?: string,
): LeadType | null {
  const types = playbook ? typesFromPlaybook(playbook) : [];
  if (!types.length) return null;
  if (typeName) {
    const match = types.find(
      (item) => item.name.toLowerCase() === typeName.toLowerCase(),
    );
    if (match) return match;
  }
  return pick(types);
}

function applyType(
  profile: ProspectProfile,
  leadType: LeadType | null,
): ProspectProfile {
  if (!leadType) {
    return {
      ...profile,
      talkStyle: profile.talkStyle || "rambler",
      leadTypeName: profile.leadTypeName || "",
      noiseTopics: profile.noiseTopics || [],
      heldRelevant: profile.heldRelevant || [
        "dinero real",
        "quién decide",
        "dolor de fondo",
      ],
    };
  }
  return {
    ...profile,
    talkStyle: leadType.talkStyle,
    leadTypeName: leadType.name,
    noiseTopics: leadType.noiseTopics,
    heldRelevant: leadType.heldRelevant,
    personalityNotes: [leadType.howTheyExpress, leadType.talkStyle, profile.personalityNotes]
      .filter(Boolean)
      .join(" · "),
  };
}

function personaToProfile(
  persona: LeadPersona,
  difficulty: DifficultyLevel,
  locale: (typeof PROSPECT_POOLS)["es"],
  isRealLead: boolean,
  playbook?: LeadPlaybook | null,
): ProspectProfile {
  const qualificationLevel = QUALIFICATION_BY_DIFFICULTY[difficulty];
  const objections = uniqueStrings(persona.objections);
  const held = objections[0] || "";
  const extra =
    difficulty === "easy" ? [] : objections.slice(1, 2);
  const situation = firstIdea(persona.situation, 16);
  const leadType = resolveType(playbook, persona.typeName);
  return applyType(
    {
      name: persona.name,
      age: persona.age,
      occupation: persona.occupation || pick(locale.occupations[difficulty]),
      location: persona.location || pick(locale.locations),
      qualificationLevel,
      qualificationSummary: pick(locale.qualificationSummary[difficulty]),
      howTheyKnowTheOffer: pick(locale.awareness[difficulty]),
      preQualification: {
        mainGoal: situation || pick(locale.genericGoal(persona.name)),
        currentSituation: situation,
        timeline: pick(locale.timeline[difficulty]),
        budgetRange: persona.money || pick(locale.budget[difficulty]),
        decisionMaker: persona.decision || pick(locale.decisionMaker[difficulty]),
      },
      pains: situation ? [situation] : [],
      urgency: situation,
      desire: firstIdea(persona.situation, 12),
      pastAttempts: "",
      partnerSituation: persona.decision,
      moneySituation: persona.money,
      timeSituation: pick(locale.time[difficulty]),
      objections: uniqueStrings([held, ...extra]),
      personalityNotes: persona.speechStyle || "",
      heldObjection: held,
      isRealLead,
    },
    leadType,
  );
}

function compositeFromPlaybook(
  playbook: LeadPlaybook,
  difficulty: DifficultyLevel,
  language: LanguageCode,
): ProspectProfile {
  const locale = PROSPECT_POOLS[language];
  const person = pick(locale.people);
  const bank = uniqueStrings([
    ...playbook.typicalObjections.map((item) => item.quote),
    ...playbook.personas.flatMap((persona) => persona.objections),
  ]);
  const held = bank[0]
    ? pick(bank)
    : pick(locale.objections[difficulty])[0] || "";
  const rest = bank.filter((item) => item !== held);
  const extra = difficulty !== "easy" && rest.length ? [pick(rest)] : [];
  const donor = playbook.personas.length ? pick(playbook.personas) : null;
  const leadType = resolveType(playbook, donor?.typeName);
  const situation = firstIdea(
    leadType?.commonSituation || donor?.situation || playbook.icp,
    18,
  );
  const phrases = uniqueStrings([
    ...(leadType?.commonPhrases || []),
    ...playbook.phrases,
    ...(donor?.typicalLines || []),
  ]).slice(0, 5);

  return applyType(
    {
      name: person.name,
      age: donor?.age || ageForKind("generic"),
      occupation:
        donor?.occupation || pick(locale.occupations[difficulty]),
      location: donor?.location || pick(locale.locations),
      qualificationLevel: QUALIFICATION_BY_DIFFICULTY[difficulty],
      qualificationSummary: pick(locale.qualificationSummary[difficulty]),
      howTheyKnowTheOffer: pick(locale.awareness[difficulty]),
      preQualification: {
        mainGoal: situation || pick(locale.genericGoal(person.name)),
        currentSituation: situation,
        timeline: pick(locale.timeline[difficulty]),
        budgetRange: donor?.money || pick(locale.budget[difficulty]),
        decisionMaker: donor?.decision || pick(locale.decisionMaker[difficulty]),
      },
      pains: situation ? [situation] : painsFor("generic", "la oferta", locale, difficulty),
      urgency: situation,
      desire: firstIdea(playbook.buyingTriggers[0] || situation, 12),
      pastAttempts: "",
      partnerSituation: donor?.decision || pick(locale.partner[difficulty]),
      moneySituation: donor?.money || pick(locale.money[difficulty]),
      timeSituation: pick(locale.time[difficulty]),
      objections: uniqueStrings([held, ...extra]),
      personalityNotes: phrases.join(" / "),
      heldObjection: held,
      isRealLead: false,
    },
    leadType,
  );
}

function profileFromReplay(
  replay: ReplayCall,
  difficulty: DifficultyLevel,
  language: LanguageCode,
  playbook?: LeadPlaybook | null,
): ProspectProfile {
  const locale = PROSPECT_POOLS[language];
  const held =
    replay.objections.split(/[|;,/]/).map((item) => item.trim()).filter(Boolean)[0] ||
    replay.leadLines.find((line) =>
      /caro|precio|plata|dinero|pienso|después|socio|esposa|tiempo|ahora no/i.test(
        line,
      ),
    ) ||
    replay.leadLines[0] ||
    "lo voy a pensar";
  const situation = replay.summary || replay.leadLines[0] || replay.title;
  const matchedType = playbook
    ? typesFromPlaybook(playbook).find((item) => {
        const blob = `${replay.excerpt} ${replay.title}`.toLowerCase();
        return item.name && blob.includes(item.name.toLowerCase().slice(0, 12));
      }) || null
    : null;
  const leadType = matchedType || resolveType(playbook);
  return applyType(
    {
      name: replay.leadName || pick(locale.people).name,
      age: 38,
      occupation: pick(locale.occupations[difficulty]),
      location: pick(locale.locations),
      qualificationLevel: QUALIFICATION_BY_DIFFICULTY[difficulty],
      qualificationSummary:
        "Esta es la misma persona de una llamada que NO cerró. Mismos hechos, misma resistencia.",
      howTheyKnowTheOffer: "Ya tuvieron la reunión. Esto es el do-over de esa llamada.",
      preQualification: {
        mainGoal: situation,
        currentSituation: situation,
        timeline: pick(locale.timeline[difficulty]),
        budgetRange: pick(locale.budget[difficulty]),
        decisionMaker: pick(locale.decisionMaker[difficulty]),
      },
      pains: [situation],
      urgency: situation,
      desire: situation,
      pastAttempts: "Ya hablaron y no cerró.",
      partnerSituation: "",
      moneySituation: "",
      timeSituation: "",
      objections: uniqueStrings([held, ...replay.leadLines.slice(0, 3)]),
      personalityNotes: replay.leadLines.slice(0, 4).join(" / "),
      heldObjection: held,
      isRealLead: true,
    },
    leadType,
  );
}

export function generateProspectProfile(
  productName: string,
  productDescription: string,
  difficulty: DifficultyLevel,
  language: LanguageCode = "es",
  playbook?: LeadPlaybook | null,
  practiceFocus?: string,
  replay?: ReplayCall | null,
): ProspectProfile {
  const locale = PROSPECT_POOLS[language];
  if (replay) {
    return profileFromReplay(replay, difficulty, language, playbook);
  }
  if (playbook && isPlaybookReady(playbook)) {
    const focus = String(practiceFocus || "").trim().toLowerCase();
    const matched =
      focus && playbook.personas.length
        ? playbook.personas.find((persona) => {
            const name = persona.name.toLowerCase();
            return (
              name &&
              name !== "lead" &&
              (focus.includes(name) || name.includes(focus))
            );
          })
        : undefined;
    if (matched) {
      return personaToProfile(matched, difficulty, locale, true, playbook);
    }
    return compositeFromPlaybook(playbook, difficulty, language);
  }
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
  const objections = pick(locale.objections[difficulty]);
  const pain = painsFor(kind, productName, locale, difficulty);

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
      currentSituation: pain[0] || "",
      timeline: pick(locale.timeline[difficulty]),
      budgetRange: pick(locale.budget[difficulty]),
      decisionMaker: pick(locale.decisionMaker[difficulty]),
    },
    pains: pain,
    urgency: pick(locale.urgency[difficulty]),
    desire: pick(desirePool),
    pastAttempts: pick(locale.pastAttempts[difficulty]),
    partnerSituation: pick(locale.partner[difficulty]),
    moneySituation: pick(locale.money[difficulty]),
    timeSituation: pick(locale.time[difficulty]),
    objections,
    personalityNotes: pick(locale.personality[difficulty][person.gender]),
    heldObjection: objections[0] || "",
    isRealLead: false,
  };
}

function talkStyleBehavior(style: TalkStyle | undefined) {
  switch (style) {
    case "terse":
      return `TALK STYLE: terse
- Short answers, sometimes one clause. Not rude, just economical.
- You can add a shrug or "no sé" instead of a story.`;
    case "scattered":
      return `TALK STYLE: scattered
- You start answering, then jump to something adjacent that does not help the closer.
- You do NOT stay silent. You fill space with the wrong topic.
- Example: they ask how the business is going → you talk about a cousin, a supplier, a week from hell, then maybe one useful crumb.`;
    case "storyteller":
      return `TALK STYLE: storyteller
- You answer with a small story or example from your life/business.
- The useful fact is buried in the anecdote, not the headline.
- 2–5 spoken sentences is normal.`;
    default:
      return `TALK STYLE: rambler
- Real buyers ramble. You start on the question, then wander into noise topics.
- You do NOT dump the sales file (money, decider, real pain) while rambling.
- You DO say irrelevant or half-relevant stuff: operations, family color, complaints, comparisons that don't matter.
- 2–4 spoken sentences is normal. Stopping after one perfect sentence is fake.`;
  }
}

function disclosureBlock(training: TrainingSessionConfig) {
  const p = training.prospectProfile;
  const held = p.heldObjection || p.objections[0] || "";
  const noise = (p.noiseTopics || []).join(" · ") || "anécdotas del día a día";
  const heldBits =
    (p.heldRelevant || []).join(" · ") || "dinero real, quién decide, dolor de fondo";
  return `## Shared type vs what you withhold

This offer's buyers share situation and phrases. You are type: ${p.leadTypeName || "típico de esta oferta"}.
Shared situation (you may color it, not recite it as a form): ${p.pains[0] || p.preQualification.currentSituation}
How you say it: ${p.personalityNotes}

NOISE you can volunteer without being asked: ${noise}

RELEVANT — this is what they want. Difficulty decides how locked it is:
- ${heldBits}
- Held objection: ${held}
- Money: ${p.moneySituation || p.preQualification.budgetRange}
- Who decides: ${p.preQualification.decisionMaker || p.partnerSituation}
- Real urgency/desire: ${p.urgency} / ${p.desire}

Difficulty ${training.difficulty}:
${
  training.difficulty === "easy"
    ? "- You ramble/talk in your style AND useful crumbs leak if they ask anything decent. Still do not volunteer the full file in turn one."
    : training.difficulty === "medium"
      ? "- Plenty of talk. Useful facts only if they ask a specific question and listen. 'Cuéntame de ti' gets noise + one vague line."
      : "- You can talk a lot. The close-relevant facts stay locked until a precise, human question. Repeating a cliché gets more noise or the same objection, not the truth."
}`;
}

function difficultyBehavior(difficulty: DifficultyLevel, style?: TalkStyle): string {
  const base =
    difficulty === "easy"
      ? `- Warm enough to buy the entry offer if they connect it to your case. Never volunteer the yes.`
      : difficulty === "medium"
        ? `- Real interest AND one blocker. You do not hand them the blocker.`
        : `- Skeptical. The close is not a gift. Repeat the held objection if they answer with a cliché.`;
  return `${base}\n${talkStyleBehavior(style)}`;
}

function sectionBehavior(
  section: CallSection,
  training: TrainingSessionConfig,
): string {
  const { productName, pitchSummary } = training;

  switch (section) {
    case "full":
      return `MODE: FULL MEETING
- You booked this about "${productName}". You are not on a cold call.
- Do not speak first. Do not announce that you booked it unless asked.
- Discovery → pitch → close is their job. Yours is to be a real person in the chair.`;

    case "discovery":
      return `MODE: DISCOVERY ONLY
- You booked this about "${productName}".
- Do not speak first. Do not ask for price. Do not ask them to pitch.
- If they start selling, say you want to see if it even fits.`;

    case "pitch":
      return `MODE: PITCH ONLY
- Discovery already happened. You are mid-meeting. No greeting.
- React to the offer. Use the held objection when they get to price or commitment.
- Do not re-tell your whole story.`;

    case "close":
      return `MODE: CLOSE ONLY
- Post-pitch. You already know "${productName}".
${pitchSummary?.trim() ? `- Pitch you already heard: ${pitchSummary.trim().slice(0, 400)}` : ""}
- Decision time. Object or stall. If they handle it well, you may move. If they are generic, hold.`;

    case "pitch_close":
      return `MODE: PITCH + CLOSE
- Mid-meeting. No greeting. Wait for the pitch, then decide.
- Do not re-open your biography.`;
  }
}

function antiPatterns(style?: TalkStyle) {
  const terseOk = style === "terse";
  return `## Forbidden

BAD: reciting the sales file (money + decider + pain + timeline) in one turn, then asking the closer a coaching question.
BAD: becoming the interviewer ("¿cuál es tu proceso?", "¿qué más quieres saber?").
BAD: impersonating a specific uploaded client unless you were told you ARE that person.
${
  terseOk
    ? "For YOU (terse): a short answer is correct. Do not fake a speech."
    : "BAD: answering with one perfect sentence and going silent. Real people of your type add color, noise, or a side path. The skill is WHAT you mix in, not that you shut up."
}

GOOD ramble: they ask what you do → you talk about the business AND a side complaint, without naming budget or who decides.
GOOD hard: lots of words about noise, still hiding the real number.`;
}

export function buildProspectInstructions(
  training: TrainingSessionConfig,
  closerName = "closer",
  playbook?: LeadPlaybook | null,
): string {
  const p = training.prospectProfile;
  const lang = getLanguage(training.language);
  const book =
    playbook && isPlaybookReady(playbook)
      ? playbook
      : training.leadPlaybook && isPlaybookReady(training.leadPlaybook)
        ? training.leadPlaybook
        : null;

  const flavorPhrases = uniqueStrings([
    ...(book?.phrases || []),
    ...(p.noiseTopics || []),
    ...(book?.sampleReplies || []),
  ]).slice(0, 6);
  const neverDo = (book?.neverDo || []).slice(0, 6);
  const talk = book?.howLeadsTalk?.slice(0, 500) || p.personalityNotes;
  const types = book ? typesFromPlaybook(book) : [];

  const identity =
    training.practiceKind === "replay" && training.replayCall
      ? `REPLAY MODE. You ARE ${p.name}, the exact buyer from a real call that DID NOT CLOSE.
Do not invent a new person. Copy their rhythm and the lines they actually used.
Held resistance from that call stays. The closer is attempting that call again — not a follow-up weeks later unless they frame it that way.
Verbatim flavor from that call: ${training.replayCall.leadLines.slice(0, 8).join(" | ") || training.replayCall.excerpt.slice(0, 500)}
Why it likely died: ${training.replayCall.result || "no cerró"} ${training.replayCall.objections || p.heldObjection || ""}`
      : p.isRealLead
        ? `You ARE this specific lead: ${p.name}. Keep their facts. Still withhold relevant info according to difficulty — being them is not dumping their file.`
        : `COMPOSE MODE. You are a NEW person (${p.name}) built from how buyers of this offer behave. Same types, phrases, and situations. Not a clone of one uploaded name.`;

  const playbookBlock = book
    ? `
## Offer buyer types
${types.map((item) => `- ${item.name} (${item.talkStyle}): ${item.commonSituation}`).join("\n") || `- ${book.icp}`}
You are: ${p.leadTypeName || types[0]?.name || "típico"}
- Rhythm of this offer: ${talk}
- Shared phrases (use naturally, not as a list): ${flavorPhrases.join(" / ") || "spoken, not a pitch deck"}
- Do not: ${neverDo.join(" | ") || "sound like a salesperson or an AI coach"}
${identity}
`
    : `
## Identity
${identity}
`;

  return `You are the BUYER in a booked sales meeting roleplay. Not an AI, not a coach, not an interviewer.
Always speak ${lang.promptName}. Spoken, messy, human.
${playbookBlock}

## Who you are
- ${p.name}, ${p.age}, ${p.occupation}, ${p.location}

## What they are selling
- ${training.productName}
- ${training.productDescription}

${disclosureBlock(training)}

## Difficulty + type
${difficultyBehavior(training.difficulty, p.talkStyle)}

## Meeting mode
${sectionBehavior(training.callSection, training)}
${
  training.practiceFocus?.trim()
    ? `
## Coach objective
Steer toward this situation without dumping it on turn one: "${training.practiceFocus.trim()}".
`
    : ""
}

${antiPatterns(p.talkStyle)}
${
  training.practiceKind === "replay" && training.replayCall
    ? `
## Previous failed call (private memory — do not recap it as a monologue)
Title: ${training.replayCall.title}
Excerpt: ${training.replayCall.excerpt.slice(0, 1800)}
Stay in character as that buyer. If they handle the old objection well, you may soften. If they repeat the same pitch, hold.
`
    : ""
}

## Rules
1. You are the buyer. You are not running the meeting.
2. Buyer questions only when they try to close ("¿y si no funciona?", "¿lo hablo con mi socio?"). Never coaching questions.
3. Length follows YOUR talk style, not a global mute button. Terse stays short. Ramblers/storytellers/scattered talk.
4. What you withhold is the relevant close-info, not speech itself.
5. Never coach, never evaluate, never say you are a simulation.
6. If they pitch early or sound scripted, get colder or wander.
7. Name "${closerName}" only if they introduced themselves.
8. You already know what this meeting is about. Never ask "what is this?".
9. Do not speak first.
10. Hold your one real objection. Repeat it if they answer with a cliché.
11. Language: ${lang.nativeName} only.`;
}

export function shouldShowProspectBrief(section: CallSection): boolean {
  return section === "pitch" || section === "close" || section === "pitch_close";
}

export function requiresPitchSummary(section: CallSection): boolean {
  return section === "close";
}

export function maxTokensForProspect(
  difficulty: DifficultyLevel,
  talkStyle?: TalkStyle,
) {
  const ramble =
    talkStyle === "rambler" ||
    talkStyle === "storyteller" ||
    talkStyle === "scattered";
  if (ramble) {
    if (difficulty === "hard") return 320;
    if (difficulty === "medium") return 380;
    return 420;
  }
  if (difficulty === "hard") return 160;
  if (difficulty === "medium") return 220;
  return 260;
}

export function maxTokensForDifficulty(difficulty: DifficultyLevel) {
  return maxTokensForProspect(difficulty);
}
