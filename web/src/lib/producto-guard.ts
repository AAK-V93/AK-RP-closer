/** Server-side gate: Producto only stores a saved offer. Agreements go to acuerdo; chat requests are dropped. */

export type OfferRef = { productName: string; aliases?: string[] };

export type ProductoAction = "keep" | "alias" | "acuerdo" | "request" | "clear";

export type ProductoPlan = {
  producto: string;
  acuerdo: string;
  ignore: boolean;
  action: ProductoAction;
};

export type LeadMention<T extends { id: string; name: string }> =
  | { kind: "exact"; lead: T }
  | { kind: "clarify"; candidates: T[] }
  | { kind: "none" };

const NAME_STOP = new Set([
  "lista",
  "listas",
  "seguimiento",
  "seguimientos",
  "producto",
  "productos",
  "oferta",
  "ofertas",
  "viernes",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "sabado",
  "domingo",
  "quedamos",
  "quedo",
  "quede",
  "acuerdo",
  "porfa",
  "porfavor",
  "dame",
  "muestrame",
  "ensename",
  "reserva",
  "reservas",
  "cuota",
  "cuotas",
  "pago",
  "pagos",
  "nada",
  "cash",
  "hoy",
  "llamada",
  "llamadas",
  "transcript",
  "cliente",
  "nombre",
  "confirmo",
  "cambia",
  "cambiar",
  "actualiza",
  "ponle",
  "borra",
  "elimina",
  "quita",
  "anula",
  "favor",
  "entera",
  "enteros",
  "todo",
  "todos",
  "toda",
  "todas",
  "para",
  "como",
  "cual",
  "cuando",
  "donde",
  "quien",
  "tiene",
  "tengo",
  "quiero",
  "quieres",
  "puedes",
  "puede",
  "hacer",
  "hago",
  "sobre",
  "desde",
  "hasta",
  "este",
  "esta",
  "estos",
  "estas",
  "mes",
  "semana",
  "cobrado",
  "vendido",
  "dinero",
  "juego",
  "pendiente",
  "pendientes",
  "avisaba",
  "retomar",
]);

export function foldProducto(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function asOfferRefs(offers: ReadonlyArray<string | OfferRef>): OfferRef[] {
  return offers
    .map((offer) => (typeof offer === "string" ? { productName: offer } : offer))
    .map((offer) => ({
      productName: String(offer.productName || "").trim(),
      aliases: (offer.aliases || []).map((alias) => String(alias || "").trim()).filter(Boolean),
    }))
    .filter((offer) => offer.productName);
}

function phraseIn(haystack: string, name: string) {
  if (!name) return false;
  return ` ${haystack} `.includes(` ${name} `);
}

function editDistance(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 2) return 3;
  const prev = new Array<number>(right.length + 1);
  const cur = new Array<number>(right.length + 1);
  for (let col = 0; col <= right.length; col += 1) prev[col] = col;
  for (let row = 1; row <= left.length; row += 1) {
    cur[0] = row;
    let rowMin = cur[0];
    for (let col = 1; col <= right.length; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      cur[col] = Math.min(prev[col] + 1, cur[col - 1] + 1, prev[col - 1] + cost);
      if (cur[col] < rowMin) rowMin = cur[col];
    }
    if (rowMin > 2) return 3;
    for (let col = 0; col <= right.length; col += 1) prev[col] = cur[col];
  }
  return prev[right.length];
}

export function isLeadAgreement(text: string) {
  const folded = foldProducto(text);
  if (!folded) return false;
  return /\b(quedamos|quede|quedo|acuerdo|avisaba|me avisa|el viernes|vamos a|va a pagar|me dijo|retomar)\b/.test(
    folded,
  );
}

export function isChatRequest(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const folded = foldProducto(raw);
  if (/\b(dame|muestrame|ensename|porfa)\b/.test(folded)) return true;
  if (/\bpor favor\b/.test(folded) && /\b(dame|lista|muestra|muestrame|dime|ensename)\b/.test(folded)) {
    return true;
  }
  if (/\blista de seguimientos\b/.test(folded)) return true;
  if (/^(lista|muestrame|ensename|dime)\b/.test(folded)) return true;
  if (/[?¿]/.test(raw) && !isLeadAgreement(raw)) return true;
  return false;
}

function emptyPlan(action: ProductoAction, acuerdo = ""): ProductoPlan {
  return { producto: "", acuerdo, ignore: action === "request", action };
}

/** Accept producto only when it is a saved offer (accent/case or a declared alias). */
export function planProductoWrite(raw: string, offers: ReadonlyArray<string | OfferRef>): ProductoPlan {
  const text = String(raw || "").trim();
  const folded = foldProducto(text);
  if (!folded || /^(otros|null|n\/a|na|sin oferta|sin producto)$/.test(folded)) {
    return emptyPlan("clear");
  }
  for (const offer of asOfferRefs(offers)) {
    const canonical = offer.productName;
    if (foldProducto(canonical) === folded) {
      return {
        producto: canonical,
        acuerdo: "",
        ignore: false,
        action: text === canonical ? "keep" : "alias",
      };
    }
    if ((offer.aliases || []).some((alias) => foldProducto(alias) === folded)) {
      return { producto: canonical, acuerdo: "", ignore: false, action: "alias" };
    }
  }
  if (isChatRequest(text)) return emptyPlan("request");
  if (isLeadAgreement(text)) return emptyPlan("acuerdo", text);
  return emptyPlan("clear");
}

export function canonicalOfferName(raw: string, offers: ReadonlyArray<string | OfferRef>) {
  return planProductoWrite(raw, offers).producto;
}

export function describeProductoPlan(plan: ProductoPlan) {
  if (plan.action === "keep") return "dejar";
  if (plan.action === "alias") return `mapear a «${plan.producto}»`;
  if (plan.action === "acuerdo") return "mover el texto a acuerdo";
  if (plan.action === "request") return "borrar (petición al chat)";
  return "borrar (no es una oferta)";
}

export function applyProductoGuard<
  T extends { producto: string | null; acuerdo_seguimiento?: string | null; confianza?: { producto?: number } },
>(parsed: T, offers: ReadonlyArray<string | OfferRef>) {
  const plan = planProductoWrite(parsed.producto || "", offers);
  if (plan.producto) {
    parsed.producto = plan.producto;
    return plan;
  }
  if (plan.acuerdo && !String(parsed.acuerdo_seguimiento || "").trim()) {
    parsed.acuerdo_seguimiento = plan.acuerdo;
  }
  if (parsed.producto) {
    parsed.producto = null;
    if (parsed.confianza) parsed.confianza.producto = 0;
  }
  return plan;
}

export function leadMention<T extends { id: string; name: string }>(
  text: string,
  leads: readonly T[],
): LeadMention<T> {
  const folded = foldProducto(text);
  if (!folded) return { kind: "none" };
  const exact = leads
    .filter((lead) => {
      const name = foldProducto(lead.name);
      return name.length >= 3 && phraseIn(folded, name);
    })
    .sort((a, b) => foldProducto(b.name).length - foldProducto(a.name).length);
  if (exact[0]) return { kind: "exact", lead: exact[0] };

  const tokens = folded.split(" ").filter((part) => part.length >= 4 && !NAME_STOP.has(part));
  const found: T[] = [];
  const seen = new Set<string>();
  const add = (lead: T) => {
    if (seen.has(lead.id)) return;
    seen.add(lead.id);
    found.push(lead);
  };
  for (const lead of leads) {
    const parts = foldProducto(lead.name).split(" ").filter(Boolean);
    const first = parts[0] || "";
    if (first.length < 4 || NAME_STOP.has(first)) continue;
    if (tokens.includes(first) && parts.length > 1) {
      add(lead);
      continue;
    }
    if (first.length < 5) continue;
    for (const token of tokens) {
      if (token.length < 5 || token === first) continue;
      const distance = editDistance(token, first);
      if (distance >= 1 && distance <= 2) {
        add(lead);
        break;
      }
    }
  }
  if (!found.length) return { kind: "none" };
  return { kind: "clarify", candidates: found.slice(0, 3) };
}

export function leadClarifyReply(candidates: { name: string }[]) {
  const names = candidates.map((row) => row.name.trim()).filter(Boolean).slice(0, 3);
  if (!names.length) return "No encontré ese lead. No cambié nada.";
  if (names.length === 1) return `¿Te refieres a ${names[0]}? No cambié nada.`;
  const last = names[names.length - 1];
  return `¿Te refieres a ${names.slice(0, -1).join(", ")} o ${last}? No cambié nada.`;
}

/** "Listo" is only for a write that already named the lead. */
export function stripFalseListo(reply: string, wrote: boolean, leadName?: string) {
  const text = String(reply || "").trim();
  if (!/^listo\b/i.test(text)) return text;
  const named = foldProducto(leadName || "");
  if (wrote && named && foldProducto(text).includes(named)) return text;
  if (wrote && named) return `Listo. En ${leadName} quedó guardado el cambio.`;
  if (/^listo,?\s+cancel/i.test(text)) return "Cancelé eso. No cambié nada.";
  return "No cambié nada.";
}

export type LeadProductoRepair = {
  id: string;
  leadName: string;
  current: string;
  action: ProductoAction;
  proposal: string;
  data: { offerName: string; nextStep?: string; lastSummary?: string };
};

export function planLeadProductoRepair(
  lead: { id: string; name: string; offerName: string; nextStep?: string; lastSummary?: string },
  offers: ReadonlyArray<string | OfferRef>,
): LeadProductoRepair | null {
  const current = String(lead.offerName || "").trim();
  if (!current) return null;
  const plan = planProductoWrite(current, offers);
  if (plan.action === "keep") return null;
  const data: LeadProductoRepair["data"] = { offerName: plan.producto };
  if (plan.action === "acuerdo" && plan.acuerdo) {
    const step = String(lead.nextStep || "").trim();
    const notes = String(lead.lastSummary || "").trim();
    if (!step) data.nextStep = plan.acuerdo;
    else if (!notes.includes(plan.acuerdo)) {
      data.lastSummary = notes ? `${notes}\n${plan.acuerdo}` : plan.acuerdo;
    }
  }
  return {
    id: lead.id,
    leadName: lead.name,
    current,
    action: plan.action,
    proposal: describeProductoPlan(plan),
    data,
  };
}

export type CallProductoRow = {
  leadName: string;
  current: string;
  action: ProductoAction;
  proposal: string;
};

export type CallProductoRepair = {
  id: string;
  leadName: string;
  rows: CallProductoRow[];
  offerName: string;
  producto: string;
  acuerdo?: string;
  notas?: string;
};

export function planCallProductoRepair(
  call: {
    id: string;
    leadName: string;
    offerName: string;
    producto?: string;
    acuerdo?: string;
    notas?: string;
  },
  offers: ReadonlyArray<string | OfferRef>,
): CallProductoRepair | null {
  const rows: CallProductoRow[] = [];
  const offerText = String(call.offerName || "").trim();
  const productoText = String(call.producto || "").trim();
  const offerPlan = offerText ? planProductoWrite(offerText, offers) : null;
  const productoPlan = productoText ? planProductoWrite(productoText, offers) : null;
  if (offerPlan && offerPlan.action !== "keep") {
    rows.push({
      leadName: call.leadName,
      current: offerText,
      action: offerPlan.action,
      proposal: describeProductoPlan(offerPlan),
    });
  }
  if (productoPlan && productoPlan.action !== "keep" && productoText !== offerText) {
    rows.push({
      leadName: call.leadName,
      current: productoText,
      action: productoPlan.action,
      proposal: describeProductoPlan(productoPlan),
    });
  }
  if (!rows.length) return null;
  const acuerdoPlan =
    productoPlan?.action === "acuerdo"
      ? productoPlan
      : offerPlan?.action === "acuerdo"
        ? offerPlan
        : null;
  const repair: CallProductoRepair = {
    id: call.id,
    leadName: call.leadName,
    rows,
    offerName: offerText ? offerPlan?.producto || "" : offerText,
    producto: productoText ? productoPlan?.producto || "" : productoText,
  };
  if (acuerdoPlan?.acuerdo) {
    const acuerdo = String(call.acuerdo || "").trim();
    const notas = String(call.notas || "").trim();
    if (!acuerdo) repair.acuerdo = acuerdoPlan.acuerdo;
    else if (!notas.includes(acuerdoPlan.acuerdo)) {
      repair.notas = notas ? `${notas}\n${acuerdoPlan.acuerdo}` : acuerdoPlan.acuerdo;
    }
  }
  return repair;
}
