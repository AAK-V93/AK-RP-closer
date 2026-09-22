export type ThreadTipo =
  | "DECISION"
  | "COBRANZA"
  | "SEGUNDA_REUNION"
  | "RETOMAR"
  | "REAGENDAR";

export type ThreadEstado = "activo" | "pausado" | "ganado" | "perdido" | "cerrado";

export type ThreadAction =
  | "hecho"
  | "no_contesto"
  | "cerro"
  | "mostro"
  | "no_mostro"
  | "perdido"
  | "pago"
  | "reprogramado";

export type StepDef = {
  accion: string;
  canal: "WHATSAPP" | "LLAMADA" | "EMAIL";
  scriptType: string;
  from: "start" | "beforePago" | "afterPago" | "beforeMeeting";
  days: number;
  hours?: number;
  askLost?: boolean;
};

export type Sequence = {
  key: ThreadTipo;
  steps: StepDef[];
};

const DAY = 86_400_000;

export const FOLLOWUP_SEQUENCES: Record<ThreadTipo, Sequence> = {
  DECISION: {
    key: "DECISION",
    steps: [
      { accion: "enviar mensaje", canal: "WHATSAPP", scriptType: "DECISION", from: "start", days: 0 },
      { accion: "enviar mensaje", canal: "WHATSAPP", scriptType: "DECISION", from: "start", days: 2 },
      { accion: "llamar", canal: "LLAMADA", scriptType: "DECISION", from: "start", days: 5 },
      { accion: "último intento", canal: "WHATSAPP", scriptType: "DECISION", from: "start", days: 8 },
    ],
  },
  COBRANZA: {
    key: "COBRANZA",
    steps: [
      { accion: "enviar bienvenida", canal: "WHATSAPP", scriptType: "ONBOARDING", from: "start", days: 0, hours: 2 },
      { accion: "validar accesos", canal: "WHATSAPP", scriptType: "VALIDACION", from: "start", days: 1 },
      { accion: "preguntar cómo va", canal: "WHATSAPP", scriptType: "EXPERIENCIA", from: "start", days: 8 },
      { accion: "enviar recordatorio de pago", canal: "WHATSAPP", scriptType: "PRE_COBRANZA", from: "beforePago", days: 7 },
      { accion: "cobrar", canal: "WHATSAPP", scriptType: "PAGO PENDIENTE", from: "afterPago", days: 0 },
      { accion: "enviar recordatorio de pago", canal: "WHATSAPP", scriptType: "PAGO PENDIENTE", from: "afterPago", days: 1 },
      { accion: "preguntar si se perdió", canal: "WHATSAPP", scriptType: "PAGO PENDIENTE", from: "afterPago", days: 2, askLost: true },
    ],
  },
  SEGUNDA_REUNION: {
    key: "SEGUNDA_REUNION",
    steps: [
      {
        accion: "confirmar la reunión",
        canal: "WHATSAPP",
        scriptType: "SEGUNDA REUNION",
        from: "beforeMeeting",
        days: 1,
      },
    ],
  },
  RETOMAR: {
    key: "RETOMAR",
    steps: [
      { accion: "enviar reactivación", canal: "WHATSAPP", scriptType: "RETOMAR", from: "start", days: 0 },
      { accion: "enviar un guion distinto", canal: "LLAMADA", scriptType: "RETOMAR", from: "start", days: 5 },
      { accion: "último intento", canal: "WHATSAPP", scriptType: "RETOMAR", from: "start", days: 10 },
    ],
  },
  REAGENDAR: {
    key: "REAGENDAR",
    steps: [
      { accion: "proponer otra fecha", canal: "WHATSAPP", scriptType: "REAGENDAR", from: "start", days: 0 },
      { accion: "insistir para reagendar", canal: "WHATSAPP", scriptType: "REAGENDAR", from: "start", days: 2 },
    ],
  },
};

export type ThreadAnchors = {
  start: Date;
  pagoAt: Date | null;
  meetingAt: Date | null;
};

export type ExtractorSituation = {
  estado_agenda: string | null;
  requiere_seguimiento: boolean | null;
  tipo_seguimiento: string | null;
  proximo_seguimiento: string | null;
  calificado: boolean | null;
  saldo_pendiente: number | null;
  venta_total: number | null;
  cash_collected: number | null;
};

export function pickThreadKind(parsed: ExtractorSituation): ThreadTipo | null {
  const estado = parsed.estado_agenda || "";
  const tipo = (parsed.tipo_seguimiento || "").toUpperCase();
  const closed = estado === "CIERRE VENTA" || estado === "ACUERDO SIN PAGO";
  const saldo = parsed.saldo_pendiente || 0;
  const venta = parsed.venta_total || 0;
  const cash = parsed.cash_collected || 0;
  const hasSaldo =
    saldo > 0 || estado === "ACUERDO SIN PAGO" || (estado === "CIERRE VENTA" && venta > cash);
  const intention =
    parsed.calificado === true || tipo === "DECISION" || Boolean(parsed.proximo_seguimiento);

  if (estado === "NO SHOW") return "REAGENDAR";
  if (estado === "REPROGRAMA" || tipo.includes("SEGUNDA")) return "SEGUNDA_REUNION";
  if (closed && hasSaldo) return "COBRANZA";
  if (estado === "SHOW" && intention) return "DECISION";
  if (parsed.requiere_seguimiento === true && !parsed.proximo_seguimiento) return "RETOMAR";
  return null;
}

export function sequenceFor(tipo: ThreadTipo) {
  return FOLLOWUP_SEQUENCES[tipo];
}

export function stepAt(tipo: ThreadTipo, paso: number) {
  const steps = sequenceFor(tipo).steps;
  return steps[Math.min(Math.max(paso, 0), steps.length - 1)];
}

function shift(base: Date, days: number, hours = 0) {
  return new Date(base.getTime() + days * DAY + hours * 3_600_000);
}

export function stepDue(step: StepDef, anchors: ThreadAnchors, now: Date) {
  let due = anchors.start;
  if (step.from === "start") due = shift(anchors.start, step.days, step.hours || 0);
  if (step.from === "beforePago") {
    due = shift(anchors.pagoAt || shift(anchors.start, 30), -step.days);
  }
  if (step.from === "afterPago") due = shift(anchors.pagoAt || anchors.start, step.days);
  if (step.from === "beforeMeeting") {
    due = shift(anchors.meetingAt || shift(anchors.start, 1), -step.days);
  }
  return due.getTime() < now.getTime() ? now : due;
}

export function pasoLabel(paso: number, total: number) {
  const shown = Math.min(Math.max(paso, 0) + 1, total);
  return `${shown} de ${total}`;
}

const TOUCH_LABEL: Record<string, string> = {
  enviado: "enviado",
  "contestó": "contestó",
  "no_contestó": "no contestó",
  no_contesto: "no contestó",
  "mostró": "mostró",
  mostro: "mostró",
  "no_mostró": "no mostró",
  no_mostro: "no mostró",
};

export function lastTouchText(fecha: Date | null, resultado: string, now: Date) {
  if (!fecha) return "sin toques";
  const days = Math.max(0, Math.round((now.getTime() - fecha.getTime()) / DAY));
  const when = days === 0 ? "hoy" : days === 1 ? "hace 1 día" : `hace ${days} días`;
  return `${when} · ${TOUCH_LABEL[resultado] || "enviado"}`;
}

export function nextActionText(accion: string, due: Date, now: Date, askLost: boolean) {
  if (askLost) return "preguntar si se perdió";
  const pending = due.getTime() <= now.getTime();
  return pending ? `${accion} · pendiente de hoy` : accion;
}

export type AdvanceResult = {
  estado: ThreadEstado;
  pasoActual: number;
  askLost: boolean;
  dueAt: Date | null;
  spawn: ThreadTipo | null;
  touchResultado: string;
};

export function advanceThread(args: {
  tipo: ThreadTipo;
  pasoActual: number;
  action: ThreadAction;
  anchors: ThreadAnchors;
  now: Date;
  hasSaldo: boolean;
}): AdvanceResult {
  const steps = sequenceFor(args.tipo).steps;
  const land = (paso: number): AdvanceResult => {
    if (paso >= steps.length) {
      return {
        estado: "activo",
        pasoActual: steps.length - 1,
        askLost: true,
        dueAt: args.now,
        spawn: null,
        touchResultado: "no_contestó",
      };
    }
    const step = steps[paso];
    return {
      estado: "activo",
      pasoActual: paso,
      askLost: Boolean(step.askLost),
      dueAt: stepDue(step, args.anchors, args.now),
      spawn: null,
      touchResultado: "enviado",
    };
  };

  if (args.action === "perdido") {
    return {
      estado: "perdido",
      pasoActual: args.pasoActual,
      askLost: false,
      dueAt: null,
      spawn: null,
      touchResultado: "no_contestó",
    };
  }
  if (args.action === "pago" && args.tipo === "COBRANZA") {
    return {
      estado: "ganado",
      pasoActual: args.pasoActual,
      askLost: false,
      dueAt: null,
      spawn: null,
      touchResultado: "contestó",
    };
  }
  if (args.action === "cerro" && (args.tipo === "DECISION" || args.tipo === "RETOMAR")) {
    return {
      estado: "ganado",
      pasoActual: args.pasoActual,
      askLost: false,
      dueAt: null,
      spawn: args.hasSaldo ? "COBRANZA" : null,
      touchResultado: "contestó",
    };
  }
  if (args.action === "mostro" && args.tipo === "SEGUNDA_REUNION") {
    return {
      estado: "ganado",
      pasoActual: args.pasoActual,
      askLost: false,
      dueAt: null,
      spawn: null,
      touchResultado: "mostró",
    };
  }
  if (args.action === "no_mostro" && args.tipo === "SEGUNDA_REUNION") {
    return {
      estado: "cerrado",
      pasoActual: args.pasoActual,
      askLost: false,
      dueAt: null,
      spawn: "REAGENDAR",
      touchResultado: "no_mostró",
    };
  }
  if (args.action === "reprogramado") {
    return {
      estado: "activo",
      pasoActual: args.pasoActual,
      askLost: false,
      dueAt: shift(args.now, 1),
      spawn: null,
      touchResultado: "enviado",
    };
  }
  const resultado = args.action === "no_contesto" ? "no_contestó" : "enviado";
  const next = land(args.pasoActual + 1);
  next.touchResultado = resultado;
  return next;
}
