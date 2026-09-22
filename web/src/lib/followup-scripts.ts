export type FollowupScript = {
  key: string;
  type: string;
  intentosMin: number;
  canal: "WHATSAPP" | "LLAMADA" | "AUDIO" | "VIDEO";
  recomendacion: string;
  guion: string;
  asset?: string;
  originId?: string;
};

export type FollowupVars = {
  nombre: string;
  programa: string;
  monto: string;
  saldo: string;
  fecha: string;
  pago: string;
  objecion: string;
  deseo: string;
  closer: string;
};

const SLOT: Record<string, keyof FollowupVars> = {
  Nombre: "nombre",
  NOMBRE: "nombre",
  nombre: "nombre",
  "Nombre del empresario": "nombre",
  PROGRAMA: "programa",
  programa: "programa",
  "programa/mentoría": "programa",
  MONTO: "monto",
  monto: "monto",
  SALDO: "saldo",
  saldo: "saldo",
  FECHA: "fecha",
  fecha: "fecha",
  LINK: "pago",
  "LINK DE PAGO": "pago",
  "DATOS DE PAGO": "pago",
  pago: "pago",
  OBJECION: "objecion",
  objecion: "objecion",
  DESEO: "deseo",
  deseo: "deseo",
  CLOSER: "closer",
};

export function fillFollowupGuion(guion: string, vars: FollowupVars) {
  let out = guion;
  for (const [token, key] of Object.entries(SLOT)) {
    const value = vars[key];
    if (!value) continue;
    out = out.split(`[${token}]`).join(value);
    out = out.split(`"${token}"`).join(value);
  }
  return out;
}

/** Guiones genéricos. El closer pega los suyos en la oferta (commercial.scripts). */
export const DEFAULT_FOLLOWUP_SCRIPTS: FollowupScript[] = [
  {
    key: "onboarding",
    type: "ONBOARDING",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "Primeras 2 h post pago. Bienvenida, accesos, reforzar la decisión.",
    guion: `Hola [Nombre], soy [CLOSER]. Quiero darte la bienvenida a [PROGRAMA] y asegurarme de que tengas el acceso.
Si te falta algo, respóndeme por acá y lo gestionamos ya.
¡Vamos con todo!`,
  },
  {
    key: "validacion",
    type: "VALIDACION",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "24–48 h. Confirmar que entró a grupos/plataforma y dejar fechas de pago claras.",
    guion: `Hola [Nombre], ¿cómo vas? ¿Pudiste acceder bien a [PROGRAMA]?
Aprovecho para dejar mapeado el próximo pago: [FECHA] por USD [MONTO]. ¿De acuerdo?`,
  },
  {
    key: "experiencia",
    type: "EXPERIENCIA",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "Día 7–10. Cómo viene la formación; detectar fricción antes del cobro.",
    guion: `Hola [Nombre], ¿cómo vas con la primera semana de [PROGRAMA]? ¿Qué has podido implementar?`,
  },
  {
    key: "pre_cobranza",
    type: "PRE_COBRANZA",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "7 días antes de la cuota. Satisfacción + anticipar el cobro.",
    guion: `Hola [Nombre], ¿cómo vas con [PROGRAMA]?
Te recuerdo que el [FECHA] corresponde el pago de USD [MONTO]. Ese día te paso los datos y me envías el comprobante.`,
  },
  {
    key: "dia_pago",
    type: "PAGO PENDIENTE",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "Mañana del vencimiento. Link/datos + pedir voucher.",
    guion: `Hola [Nombre], hoy corresponde el pago de USD [MONTO] de [PROGRAMA].
Te dejo los datos: [DATOS DE PAGO]
Avísame por acá cuando lo hayas hecho, con el comprobante.`,
  },
  {
    key: "dia_pago_recordatorio",
    type: "PAGO PENDIENTE",
    intentosMin: 1,
    canal: "WHATSAPP",
    recomendacion: "Mismo día, si no respondió. No reenviar toda la info.",
    guion: `Hola [Nombre], te dejo el recordatorio del abono de la cuota de [PROGRAMA] (USD [MONTO]). Por acá me compartes la foto del voucher.`,
  },
  {
    key: "cobro_vencido",
    type: "COBRO_VENCIDO",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "24 h post vencimiento. Cordial y firme. Si hay fricción, escuchar antes de insistir el cobro.",
    guion: `Hola [Nombre], ayer teníamos programado el pago de USD [MONTO] de [PROGRAMA] y aún no lo registramos.
¿Se presentó alguna situación o lo podemos dejar regularizado hoy?`,
  },
  {
    key: "post_cobranza",
    type: "POST_COBRANZA",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "Pago registrado. Cerrar el loop y devolver el foco al programa.",
    guion: `Perfecto, [Nombre]. Ya tenemos tu pago de USD [MONTO] registrado. Gracias por mantener el compromiso. Seguimos con [PROGRAMA].`,
  },
  {
    key: "decision",
    type: "DECISION",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "Show que no cerró. Preguntar qué falta, no empujar precio.",
    guion: `Hola [Nombre], te escribo para retomar lo de [PROGRAMA]. ¿Qué falta para que avancemos?`,
  },
  {
    key: "retomar",
    type: "RETOMAR",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "Lead en seguimiento. Mensaje corto, una pregunta.",
    guion: `Hola [Nombre], ¿seguimos con [PROGRAMA]? Dime qué te traba y lo vemos.`,
  },
  {
    key: "no_contesta_llamada",
    type: "RETOMAR",
    intentosMin: 1,
    canal: "LLAMADA",
    recomendacion: "Ya escribiste y no contestó. Llamada en frío; si no toma, audio.",
    guion: `Hola [Nombre], te llamo para avanzar con [PROGRAMA]. ¿Qué falta para la inscripción?`,
  },
  {
    key: "no_contesta_feedback",
    type: "RETOMAR",
    intentosMin: 2,
    canal: "AUDIO",
    recomendacion: "Tercer toque. Pedir feedback, no pelear. Si no hay respuesta, el hub pregunta si lo marcas perdido.",
    guion: `Hola [Nombre], vi que no avanzamos con [PROGRAMA]. Si algo hice mal o no era el momento, dime: me sirve para no insistir de más.`,
  },
  {
    key: "reagendar",
    type: "REAGENDAR",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "No show. Reagendar a +1 día.",
    guion: `Hola [Nombre], ayer no nos encontramos. ¿Qué día te queda mejor para retomar [PROGRAMA]?`,
  },
  {
    key: "segunda_reunion",
    type: "SEGUNDA REUNION",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "Reprogramó. Confirmar la nueva fecha.",
    guion: `Hola [Nombre], te confirmo la próxima llamada de [PROGRAMA] el [FECHA]. ¿Seguimos ahí?`,
  },
  {
    key: "postergacion",
    type: "PAGO PENDIENTE",
    intentosMin: 0,
    canal: "WHATSAPP",
    recomendacion: "Pidió postergar. Tope 7 días. Preferir abono parcial hoy.",
    guion: `Te entiendo, [Nombre]. Podemos mover la fecha, pero el compromiso tiene que quedar cerrado: ¿qué día concreto puedes pagar USD [SALDO]? Si hoy puedes un parcial, mejor.`,
  },
];

export function parseFollowupScripts(raw: unknown): FollowupScript[] {
  if (!Array.isArray(raw)) return [];
  const out: FollowupScript[] = [];
  for (const item of raw) {
    const row = (item || {}) as Record<string, unknown>;
    const guion = String(row.guion || row.script || "").trim();
    const type = String(row.type || row.tipo || "").trim().toUpperCase();
    if (!guion || !type) continue;
    const canalRaw = String(row.canal || "WHATSAPP").toUpperCase();
    const canal: FollowupScript["canal"] =
      canalRaw === "LLAMADA" || canalRaw === "AUDIO" || canalRaw === "VIDEO"
        ? canalRaw
        : "WHATSAPP";
    const asset = String(row.asset || row.link || "").trim();
    out.push({
      key: String(row.key || `${type}-${guion.slice(0, 12)}`),
      type,
      intentosMin: Number(row.intentosMin || row.intento || 0) || 0,
      canal,
      recomendacion: String(row.recomendacion || row.cuando || "").trim(),
      guion,
      ...(asset ? { asset } : {}),
      originId: String(row.originId || "").trim() || undefined,
    });
  }
  return out;
}

export function isCreativeFollowup(script: { key: string; type: string }) {
  return (
    script.type === "CREATIVO" ||
    /premonic|poema|noticia-de-ultimo|cumpleanos|testimonial|ni-mi-ex/.test(script.key)
  );
}

export function listFollowupScripts(
  type: string,
  intentos: number,
  custom: FollowupScript[] = [],
): FollowupScript[] {
  const match = (row: FollowupScript) => {
    const typeOk = row.type === type || (type === "OTRO" && row.type === "RETOMAR");
    if (!typeOk || row.intentosMin > intentos) return false;
    if (type !== "CREATIVO" && isCreativeFollowup(row)) return false;
    return true;
  };
  const own = custom.filter(match).sort((a, b) => b.intentosMin - a.intentosMin);
  const base = DEFAULT_FOLLOWUP_SCRIPTS.filter(match).sort(
    (a, b) => b.intentosMin - a.intentosMin,
  );
  return [...own, ...base];
}

export function pickFollowupScript(
  type: string,
  intentos: number,
  custom: FollowupScript[] = [],
): FollowupScript | null {
  return listFollowupScripts(type, intentos, custom)[0] || null;
}

export function followupQuestion(type: string, nombre: string, enJuego: number) {
  if (type === "ONBOARDING") return `Onboarding de ${nombre}: ¿le diste la bienvenida y los accesos?`;
  if (type === "VALIDACION") return `¿${nombre} ya accedió a todo? ¿Validaste las fechas de pago?`;
  if (type === "EXPERIENCIA") return `¿Cómo va ${nombre} en la primera semana? ¿Lo contactaste?`;
  if (type === "PRE_COBRANZA") return `En 7 días cobra ${nombre}. ¿Le recuerdas la cuota?`;
  if (type === "PAGO PENDIENTE")
    return `Hoy: cobrar USD ${enJuego || "el saldo"} a ${nombre}. ¿Lo hiciste?`;
  if (type === "COBRO_VENCIDO")
    return `Cuota vencida de ${nombre} (USD ${enJuego || "saldo"}). ¿Qué pasó?`;
  if (type === "POST_COBRANZA") return `¿Le confirmaste a ${nombre} que el pago quedó registrado?`;
  if (type === "COMISION") return `¿Ya te pagaron la comisión de ${nombre}?`;
  if (type === "AGENDA_CHECK") return `¿Se hizo la llamada con ${nombre}?`;
  return `Hoy: seguimiento con ${nombre} (${type}). ¿Lo hiciste?`;
}

export function buildFollowupCopy(args: {
  type: string;
  intentos?: number;
  vars: FollowupVars;
  custom?: FollowupScript[];
}) {
  const script = pickFollowupScript(args.type, args.intentos || 0, args.custom || []);
  if (!script) {
    return {
      mensaje: `Hola ${args.vars.nombre}, te escribo por ${args.vars.programa || "lo que hablamos"}.`,
      recomendacion: "",
      canal: "WHATSAPP" as const,
      asset: "",
      originId: "",
    };
  }
  return {
    mensaje: fillFollowupGuion(script.guion, args.vars),
    recomendacion: script.recomendacion,
    canal: script.canal,
    asset: script.asset || "",
    originId: script.originId || "",
  };
}

export function collectionSequence(args: {
  callAt: Date;
  pagoAt: Date | null;
  hasSaldo: boolean;
  closed: boolean;
}) {
  const steps: { type: string; dueAt: Date }[] = [];
  if (args.closed) {
    steps.push({ type: "ONBOARDING", dueAt: new Date(args.callAt.getTime() + 2 * 3600 * 1000) });
    steps.push({ type: "VALIDACION", dueAt: new Date(args.callAt.getTime() + 24 * 3600 * 1000) });
    steps.push({ type: "EXPERIENCIA", dueAt: new Date(args.callAt.getTime() + 8 * 86400000) });
  }
  if (args.hasSaldo && args.pagoAt) {
    const pre = new Date(args.pagoAt.getTime() - 7 * 86400000);
    if (pre.getTime() > Date.now() + 12 * 3600 * 1000) {
      steps.push({ type: "PRE_COBRANZA", dueAt: pre });
    }
    steps.push({ type: "PAGO PENDIENTE", dueAt: args.pagoAt });
  }
  return steps;
}

export function nextAfterHecho(type: string): string | null {
  if (type === "ONBOARDING") return "VALIDACION";
  if (type === "VALIDACION") return "EXPERIENCIA";
  if (type === "PAGO PENDIENTE") return "POST_COBRANZA";
  if (type === "COBRO_VENCIDO") return "POST_COBRANZA";
  return null;
}
