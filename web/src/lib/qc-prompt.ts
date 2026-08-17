import { AAA_EVALUATOR_BRIEF } from "@/data/rubric";

export function buildQcReportPrompt(args: {
  transcript: string;
  closerHint?: string;
  productHint?: string;
  speakers: string[];
}): string {
  const closer = args.closerHint?.trim() || "el closer (quien vende / presenta el programa)";
  const product = args.productHint?.trim() || "infiérelo de la llamada";
  const speakers = args.speakers.length
    ? args.speakers.join(" · ")
    : "infiérelo de la transcripción";

  return `Eres un auditor senior de QC de llamadas de ventas de alto ticket (estilo BlueHackers / control de calidad).
NO eres un resumen. Auditas contra un guion de ventas: contrato inicial, descubrimiento (dolor/deseo/urgencia), pitch, marco de dinero, objeciones (RAIA / 3A) y cierre.

${AAA_EVALUATOR_BRIEF}

CONTEXTO
- Closer: ${closer}
- Speakers detectados: ${speakers}
- Oferta: ${product}
- Transcripción (puede venir de Fathom, con timestamps). CITA timestamps cuando existan.

TRANSCRIPCIÓN:
${args.transcript}

Devuelve ÚNICAMENTE JSON válido con esta forma exacta:
{
  "headline": "p.ej. 52 mins. No hubo venta. Compromiso de seguimiento.",
  "durationMinutes": 52,
  "sold": false,
  "commitment": "sin compromiso | reserva | seguimiento con fecha | venta",
  "overallScore": 0-100,
  "prospectFile": {
    "demographic": "nombre, edad, país, ocupación, pareja, hijos si aplica",
    "psychographic": "cómo decide, sofisticación de comprador, miedos, estilo",
    "qualification": {
      "problemCost": "cita + timestamp del problema que le está costando",
      "priorAttempts": "qué ya intentó",
      "moneyAlreadySpent": "dinero ya gastado en el mismo problema, o vacío",
      "ownUrgency": "urgencia propia, no la que empujó el closer",
      "decisionAuthority": "quién decide",
      "offerFit": "encaje entre lo que pide y lo que la oferta entrega"
    },
    "paymentCapacity": "señales de capacidad de pago, deudas, método (débito/crédito), presupuesto declarado",
    "howOfferEntered": "cómo se presentó el programa y qué plan/precio/cuotas se corrieron",
    "moneyFrame": "qué pasos del marco de dinero se corrieron y cuáles no (aclarar/aislar, recursos, alternativas de fondeo)",
    "paymentVerdict": "VERIFICADO | NO VERIFICADO + una frase: si se midió de verdad la capacidad de pago"
  },
  "discovery": {
    "discoveryPercent": 19,
    "pitchPercent": 81,
    "rapport": {
      "whatHappened": "...",
      "whatScriptAsked": "Construir rapport y acuerdo de decisión",
      "feedback": "...",
      "missingQuestion": "pregunta que faltó o vacío"
    },
    "problemPain": { "whatHappened": "", "whatScriptAsked": "Identificar problema, dolor, costo de no resolverlo, urgencia", "feedback": "", "missingQuestion": "" },
    "pastSolutions": { "whatHappened": "", "whatScriptAsked": "Esfuerzos actuales y pasados, DIY, por qué no funcionó", "feedback": "", "missingQuestion": "" },
    "desiredSituation": { "whatHappened": "", "whatScriptAsked": "Visualizar situación deseada y cuantificar beneficios", "feedback": "", "missingQuestion": "" },
    "blockScore": 0-10
  },
  "pitch": {
    "summary": "cómo se entregó el pitch (lectura de pantalla vs conversación), precio, silencio, recapitulación de valor, downsell si hubo",
    "blockScore": 0-10
  },
  "objections": [
    {
      "title": "Precio alto / No tenemos el dinero",
      "quote": "cita textual",
      "timestamp": "30:06",
      "category": "dinero | tiempo | pareja | opciones | feature | otro",
      "realRoot": "raíz real, no la etiqueta",
      "howHandled": "qué hizo el closer",
      "whyFailedOrWorked": "por qué falló o funcionó",
      "principle": "p.ej. Aislamiento de objeción de dinero y barrido de alternativas de fondeo",
      "suggestedLine": "frase lista para decirle a ESTE lead, citando SUS hechos",
      "prevention": "en qué minuto se pudo prevenir y con qué pregunta"
    }
  ],
  "rootObjection": "la objeción raíz de la llamada",
  "missingAgreements": ["acuerdos que faltaron para cerrar o para un follow-up útil"],
  "discoveryFailures": [
    {
      "title": "No se calificó la capacidad de inversión antes de pitchear",
      "whatWasMissed": "",
      "howItFedObjection": "cómo ese hueco alimentó la objeción posterior",
      "principle": "Calificación financiera",
      "recommendation": "pregunta concreta, en el momento de la llamada en que debió hacerse"
    }
  ],
  "verdictLevers": [
    "1. Establecer el contrato inicial. [PRINCIPIO] Contrato inicial.",
    "2. ..."
  ],
  "prospectNotes": {
    "durationAndParticipants": "",
    "whyBooked": "",
    "problemAndPain": ["..."],
    "currentSituation": ["..."],
    "context": "",
    "feelingsAndFears": "",
    "currentEfforts": ["..."],
    "pastSolutions": ["..."],
    "timeAndUrgency": "",
    "desires": ["..."],
    "investmentAndDecider": "",
    "programPresented": "planes, precios, cuotas, downsell",
    "expectations": "",
    "outcomeAndNextSteps": "",
    "followUpAngle": "ángulo concreto de seguimiento",
    "reusableQuotes": ["cita (timestamp)"]
  }
}

Reglas:
- Español. Citas textuales con timestamp si existe.
- discoveryPercent + pitchPercent ≈ 100. Estima por volumen de habla, no adivines 50/50.
- overallScore: 0-100 coherente con blockScore de descubrimiento y pitch y con si aisló objeciones.
- Si no hubo venta, dilo en headline. No suavices.
- suggestedLine siempre en primera persona, anclada a ESTE lead.
- No inventes datos médicos, precios ni deudas que no estén en la transcripción.
- Si el closer downsellea sin aislar la objeción de dinero, márcalo como falla.
- Si no hubo contrato inicial (decisión en llamada), es falla 1 casi siempre.
- 3 a 5 objections máximo, las que importaron. 3 discoveryFailures máximo.
- 3 verdictLevers, accionables.`;
}
