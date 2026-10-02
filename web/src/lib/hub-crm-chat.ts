import type { Prisma, PrismaClient } from "@prisma/client";
import { patchCrmPref } from "@/lib/crm-prefs";
import { inferFollowupDate } from "@/lib/followup-date";
import {
  deskLinesFromFilings,
  followupIsClosed,
  formatPendingDesk,
  type DeskLine,
} from "@/lib/crm-followups";
import { zonedDayKey } from "@/lib/crm-time";
import { EMPTY_TRANSCRIPT_MARK } from "@/lib/fathom-import";
import { samePersonName } from "@/lib/lead-match";
import { realClientName } from "@/lib/crm-noise";
import { renameCrmCalls } from "@/lib/crm-rename";

export type ChatLead = {
  id: string;
  name: string;
  /** Name Operación and Seguimientos show, when it differs from the lead record. */
  crmName?: string;
  offerName: string;
  nextStep: string;
  lastSummary: string;
  amountPaid: string;
};

/** The name the CRM row shows. Exact, including accents. */
export function shownCrmName(lead: { name: string; crmName?: string }) {
  return (lead.crmName || lead.name).trim();
}

/** Link a stored lead to the longer or accented name the call row shows. */
export function sameDisplayedPerson(stored: string, shown: string) {
  return samePersonName(stored, shown);
}

/** Name Operación shows: real leadName, else cliente_real, else a person title. */
export function callClientName(row: {
  leadName?: string | null;
  title?: string | null;
  filingJson?: unknown;
}) {
  const filing = (row.filingJson || {}) as { cliente_real?: unknown };
  return (
    realClientName(row.leadName) ||
    realClientName(String(filing.cliente_real ?? "")) ||
    realClientName(row.title) ||
    ""
  );
}

/** Prefer the call name the CRM shows when it is not the lead record name. */
export function crmDisplayedName(leadName: string, shownNames: string[]) {
  const stored = leadName.trim();
  const matches = shownNames
    .map((name) => name.trim())
    .filter((name) => name && sameDisplayedPerson(stored, name));
  return matches.find((name) => name !== stored) || matches[0] || stored;
}

export type ChatCall = {
  leadName: string;
  acuerdo: string;
  notas: string;
  proximo: string;
  transcript?: string;
};

const CHANGE_FIELDS = [
  "name",
  "nextStep",
  "nextStepAt",
  "cash",
  "offer",
  "notes",
] as const;

export type ChatChange = {
  field: (typeof CHANGE_FIELDS)[number];
  label: string;
  from: string;
  to: string;
};

export type ChatProposal = {
  leadId: string;
  leadName: string;
  changes: ChatChange[];
  /** Same sentence must not add the cuota again while Cobrado is still this result. */
  applyKey?: string;
};

export type AppliedCash = {
  leadId: string;
  key: string;
  to: string;
};

export type ChatTurn =
  | { kind: "none" }
  | { kind: "answer"; reply: string }
  | { kind: "confirm"; reply: string; proposal: ChatProposal }
  | { kind: "apply"; proposal: ChatProposal }
  | { kind: "drop"; reply: string };

export type ChatContext = {
  leads: ChatLead[];
  calls: ChatCall[];
  pending: ChatProposal | null;
  now?: Date;
  offers?: string[];
  desk?: DeskLine[];
  appliedCash?: AppliedCash | null;
};

type LooseCrmPatch = {
  name?: string;
  offerName?: string;
  nextStep?: string;
  nextStepAt?: string;
  amountPaid?: string;
  lastSummary?: string;
};

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function leadInMessage(leads: ChatLead[], text: string) {
  const folded = fold(text);
  if (!folded) return null;
  const contained = leads
    .filter((lead) => {
      const name = fold(lead.name);
      return name.length >= 3 && folded.includes(name);
    })
    .sort((a, b) => fold(b.name).length - fold(a.name).length);
  if (contained[0]) return contained[0];
  const tokens = new Set(folded.split(" ").filter((part) => part.length >= 4));
  const byFirst = leads.filter((lead) => {
    const first = fold(lead.name).split(" ")[0] || "";
    return first.length >= 4 && tokens.has(first);
  });
  return byFirst.length === 1 ? byFirst[0] : null;
}

export function exactOfferName(names: string[], raw: string) {
  const needle = fold(raw);
  if (!needle) return "";
  return names.find((name) => fold(name) === needle) || "";
}

export function isChatCancel(text: string) {
  return isNo(text);
}

export function looksLikeFilingAnswer(text: string) {
  const raw = text.trim();
  if (!raw || raw.length > 80) return false;
  if (/[?]/.test(raw)) return false;
  if (isYes(raw) || isNo(raw)) return false;
  if (
    /se llama|transcript|quedamos|pag[oó]|pagu[eé]|en realidad|revisa|recuerdo|\boferta\b/i.test(
      raw,
    )
  ) {
    return false;
  }
  return true;
}

export function messageTargetsOtherLead(
  text: string,
  leads: ChatLead[],
  pendingLeadName: string,
) {
  const hit = leadInMessage(leads, text);
  if (!hit) return false;
  const pending = fold(pendingLeadName);
  if (!pending) return true;
  return fold(hit.name) !== pending && !fold(hit.name).startsWith(pending);
}

function isYes(text: string) {
  const raw = fold(text).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  return /^(si|confirmo|confirmar|dale|ok|okay|hazlo|adelante|de acuerdo|va)( por favor| confirmo| adelante| hazlo)?$/.test(
    raw,
  );
}

function isNo(text: string) {
  const raw = fold(text).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (/^no (recuerdo|se|queda|hay|tengo|pude|contesto)/.test(raw)) return false;
  return /^(no|no confirmo|cancela|cancelar|no cambies)( gracias)?$/.test(raw);
}

function confirmReply(leadName: string, changes: ChatChange[]) {
  if (changes.length === 1 && changes[0]?.field === "name") {
    const from = changes[0].from || leadName;
    return `Nombre de «${from}» a «${changes[0].to}». ¿Confirmo?`;
  }
  const bits = changes.map(
    (change) =>
      `${change.label} de ${leadName} de «${change.from || "—"}» a «${change.to}»`,
  );
  return `Voy a cambiar: ${bits.join("; ")}. ¿Confirmo?`;
}

function parseMoney(raw: string) {
  const digits = raw.replace(/[^\d.,]/g, "").trim();
  if (!digits) return null;
  const normalized = /^\d{1,3}(\.\d{3})+$/.test(digits)
    ? digits.replace(/\./g, "")
    : digits.replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return null;
  if (amount === 0) return "0";
  if (amount < 1) return null;
  return String(Math.round(amount));
}

function tidyName(raw: string) {
  return raw
    .split(/\s*(?:,|\by\b|\bpero\b|\bno recuerdo\b)\s*/i)[0]
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function transcriptExcerpt(text: string) {
  const lines = String(text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 12 && !/^\[sin transcripci[oó]n\]$/i.test(line));
  const interesting = lines.filter((line) =>
    /queda|acuerdo|viernes|seguim|pago|reserva|socia|cerr|vemos|llam/i.test(line),
  );
  const picked = (interesting.length ? interesting.slice(-4) : lines.slice(-4)).join(" ");
  const excerpt = picked.replace(/\s+/g, " ").trim();
  if (!excerpt) return "";
  if (excerpt.length <= 420) return excerpt;
  return `${excerpt.slice(0, 417).trim()}…`;
}

export function mentionsLeadMemory(text: string) {
  return /transcript|transcrip|acuerdo|qued|recuerdo|notas|de qu[eé] habl/i.test(text);
}

function offerList(ctx: ChatContext) {
  return (ctx.offers || []).map((name) => name.trim()).filter(Boolean);
}

function recall(text: string, ctx: ChatContext): ChatTurn | null {
  if (!/no recuerdo|en qu[eé] qued|qu[eé] quedamos|revisa el transcript|revisa el acuerdo/i.test(text)) {
    return null;
  }
  const lead = leadInMessage(ctx.leads, text);
  if (!lead) {
    return { kind: "answer", reply: "¿De quién? Dime el nombre del cliente." };
  }
  const folded = fold(lead.name);
  const same = ctx.calls.filter((row) => fold(row.leadName) === folded);
  const call = same.find((row) => row.acuerdo || row.notas) || same[0];
  const acuerdo = call?.acuerdo || lead.nextStep || "";
  const notas = call?.notas || lead.lastSummary || "";
  const transcript = transcriptExcerpt(same.map((row) => row.transcript || "").find(Boolean) || "");
  const kept = acuerdo || notas || transcript;
  if (!kept) {
    return {
      kind: "answer",
      reply: `No tengo un acuerdo guardado de ${lead.name} y no hay un transcript enlazado.`,
    };
  }
  const lines: string[] = [];
  if (acuerdo || notas) lines.push(`Con ${lead.name} quedó: «${acuerdo || notas}».`);
  else lines.push(`Con ${lead.name} no hay un acuerdo guardado.`);
  if (call?.proximo) lines.push(`Próximo seguimiento: ${call.proximo}.`);
  if (notas && acuerdo && notas !== acuerdo) lines.push(`Notas: ${notas}.`);
  if (transcript) lines.push(`En el transcript: «${transcript}».`);
  else lines.push("No hay un transcript enlazado; esto sale de lo guardado en el CRM.");
  return { kind: "answer", reply: lines.join(" ") };
}

function leadForSpokenName(ctx: ChatContext, spoken: string, raw: string) {
  const exactShown = ctx.leads.find((row) => shownCrmName(row) === spoken);
  if (exactShown) return exactShown;
  const exactStored = ctx.leads.find((row) => row.name.trim() === spoken);
  if (exactStored) return exactStored;
  const variants = ctx.leads.filter(
    (row) =>
      sameDisplayedPerson(row.name, spoken) ||
      (row.crmName ? sameDisplayedPerson(row.crmName, spoken) : false),
  );
  if (variants.length === 1) return variants[0];
  const contained = leadInMessage(ctx.leads, raw);
  if (contained && variants.some((row) => row.id === contained.id)) return contained;
  return variants[0] || contained;
}

function rename(text: string, ctx: ChatContext): ChatTurn | null {
  const match =
    text.match(/^(.+?)\s+en realidad se llama\s+(.+)$/i) ||
    text.match(/^(.+?)\s+ahora se llama\s+(.+)$/i) ||
    text.match(/^(.+?)\s+se llama\s+(.+)$/i);
  if (!match) return null;
  const spoken = tidyName(match[1]);
  const lead = leadForSpokenName(ctx, spoken, match[1]);
  const next = tidyName(match[2]);
  const current = lead ? shownCrmName(lead) : "";
  // The words in the message are the name on screen when they name this person
  // and that string is not already the record we would compare by accident.
  const from =
    lead && spoken && spoken !== current && sameDisplayedPerson(current || lead.name, spoken)
      ? spoken
      : current;
  const pending = ctx.pending;
  if (
    lead &&
    next &&
    pending?.leadId === lead.id &&
    pending.changes.some((change) => change.field === "name" && fold(change.to) === fold(next))
  ) {
    return {
      kind: "confirm",
      reply: confirmReply(from || pending.leadName || lead.name, pending.changes),
      proposal: pending,
    };
  }
  if (!lead || !next || next.length > 80 || next === from) {
    if (lead && next && next === from) {
      return { kind: "answer", reply: `${from} ya está guardado con ese nombre.` };
    }
    return null;
  }
  const proposal: ChatProposal = {
    leadId: lead.id,
    leadName: from,
    changes: [{ field: "name", label: "Nombre", from, to: next }],
  };
  const memory = /transcript|transcrip|acuerdo|qued|recuerdo/i.test(text) ? recall(text, ctx) : null;
  const reply =
    memory?.kind === "answer"
      ? `${memory.reply} ${confirmReply(from, proposal.changes)}`
      : confirmReply(from, proposal.changes);
  return { kind: "confirm", reply, proposal };
}

function schedule(text: string, ctx: ChatContext): ChatTurn | null {
  const match = text.match(
    /^(?:con\s+)?(.+?)\s+quedamos(?:\s+de\s+vernos|\s+en\s+vernos|\s+para)?\s+(.+)$/i,
  );
  if (!match) return null;
  const lead = leadInMessage(ctx.leads, match[1]) || leadInMessage(ctx.leads, text);
  if (!lead) return { kind: "answer", reply: "¿Con quién quedaste? Dime el nombre." };
  const when = inferFollowupDate(match[2], ctx.now || new Date());
  if (!when) {
    return {
      kind: "answer",
      reply: `No entendí la fecha con ${lead.name}. Dila como «9 de octubre a las 5 pm».`,
    };
  }
  const spoken = tidyName(match[2]);
  const proposal: ChatProposal = {
    leadId: lead.id,
    leadName: lead.name,
    changes: [
      {
        field: "nextStep",
        label: "Acuerdo",
        from: lead.nextStep,
        to: `Vernos ${spoken}`,
      },
      {
        field: "nextStepAt",
        label: "Próximo seguimiento",
        from: "",
        to: when,
      },
    ],
  };
  return { kind: "confirm", reply: confirmReply(lead.name, proposal.changes), proposal };
}

function pendingDesk(text: string, ctx: ChatContext): ChatTurn | null {
  if (!asksForPendingDesk(text)) return null;
  return { kind: "answer", reply: formatPendingDesk(ctx.desk || []) };
}

export function asksForPendingDesk(text: string) {
  const q = fold(text).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (/\bcambio pendiente\b|\bnada pendiente\b|\bningun cambio\b/.test(q)) return false;
  return (
    /\bpendientes?\b/.test(q) ||
    /\bque tengo hoy\b/.test(q) ||
    /\ba quien (llamo|escribo|contacto)\b/.test(q)
  );
}

function paidNow(raw: string) {
  const text = String(raw || "").trim();
  if (!text || text === "—" || text === "-") return 0;
  const normalized = /^\d{1,3}(\.\d{3})+$/.test(text)
    ? text.replace(/\./g, "")
    : text.replace(/[^\d.,]/g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount);
}

function formatMoneyEs(amount: number) {
  return String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function cuotaOrdinal(current: number, payment: number) {
  if (payment <= 0) return "cuota";
  if (current <= 0) return "1ª cuota";
  const ratio = current / payment;
  const whole = Math.round(ratio);
  if (Math.abs(ratio - whole) > 0.05) return "cuota";
  return `${whole + 1}ª cuota`;
}

function cashNumber(call: { cashCollected?: number | null; filingJson?: unknown }) {
  if (call.cashCollected != null && Number.isFinite(Number(call.cashCollected))) {
    return Math.round(Number(call.cashCollected));
  }
  const filing = (call.filingJson || {}) as { cash_collected?: unknown };
  if (filing.cash_collected == null || filing.cash_collected === "") return null;
  const amount = Number(filing.cash_collected);
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

/** Cobrado the CRM row shows: the call's cash, then the lead field. */
export function cobradoFromCalls(
  leadName: string,
  calls: {
    leadName?: string | null;
    title?: string | null;
    filingJson?: unknown;
    cashCollected?: number | null;
  }[],
) {
  for (const call of calls) {
    const name = callClientName(call) || String(call.leadName || "");
    if (!name || !sameDisplayedPerson(leadName, name)) continue;
    const cash = cashNumber(call);
    if (cash != null) return cash;
  }
  return null;
}

export function readAppliedCash(prefs: unknown): AppliedCash | null {
  if (!prefs || typeof prefs !== "object") return null;
  const raw = (prefs as Record<string, unknown>).lastCashApply;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as AppliedCash;
  if (typeof row.leadId !== "string" || !row.leadId.trim()) return null;
  if (typeof row.key !== "string" || !row.key.trim()) return null;
  if (row.to == null || String(row.to).trim() === "") return null;
  return { leadId: row.leadId, key: row.key, to: String(row.to) };
}

function payment(text: string, ctx: ChatContext): ChatTurn | null {
  const match = text.match(
    /^(?:con\s+)?(.+?)\s+(?:me\s+)?pag[oó](?:\s+(?:la|una|el)\s+(?:(?:primera|segunda|tercera|cuarta|siguiente|\d+)\s+)?cuota|\s+la\s+reserva)?(?:\s+de)?\s*(?:usd\s*)?(\d[\d.\s]*?)(?:\s*usd)?\s*$/i,
  );
  if (!match) return null;
  const lead = leadInMessage(ctx.leads, match[1]) || leadInMessage(ctx.leads, text);
  const amount = parseMoney(match[2]);
  if (!lead) return { kind: "answer", reply: "¿Quién pagó? Dime el nombre del cliente." };
  if (!amount) return { kind: "answer", reply: `¿Cuánto pagó ${lead.name}?` };
  const current = paidNow(lead.amountPaid);
  const cuota = /cuota/i.test(text);
  const added = Number(amount);
  const next = cuota ? current + added : added;
  const applyKey = `cash:${lead.id}:${fold(text)}`;
  const already = ctx.appliedCash;
  if (
    cuota &&
    already &&
    already.leadId === lead.id &&
    already.key === applyKey &&
    current === paidNow(already.to)
  ) {
    return {
      kind: "answer",
      reply: `Ya registré esa cuota. Cobrado de ${shownCrmName(lead)} sigue en ${formatMoneyEs(current)}. No lo sumé otra vez.`,
    };
  }
  if (!cuota && current === next) {
    return {
      kind: "answer",
      reply: `${shownCrmName(lead)} ya tiene ${formatMoneyEs(current)} cobrado.`,
    };
  }
  const proposal: ChatProposal = {
    leadId: lead.id,
    leadName: shownCrmName(lead),
    applyKey: cuota ? applyKey : undefined,
    changes: [
      {
        field: "cash",
        label: "Cobrado",
        from: String(current),
        to: String(next),
      },
    ],
  };
  const reply = cuota
    ? `Cobrado de ${shownCrmName(lead)} de ${formatMoneyEs(current)} a ${formatMoneyEs(next)} (${cuotaOrdinal(current, added)}). ¿Confirmo?`
    : confirmReply(shownCrmName(lead), proposal.changes);
  return { kind: "confirm", reply, proposal };
}

function clearPayment(text: string, ctx: ChatContext): ChatTurn | null {
  const match =
    text.match(/^(.+?)\s+no ha pagado nada\b/i) ||
    text.match(/^(.+?)\s+no pag[oó] nada\b/i) ||
    text.match(/^(?:pon|ponle|deja|coloca)\s+el\s+cash\s+de\s+(.+?)\s+en\s+0\b/i) ||
    text.match(/^(?:borra|elimina|quita|anula)\s+el\s+pago\s+de\s+(.+?)\s*\.?$/i);
  if (!match) return null;
  const lead = leadInMessage(ctx.leads, match[1] || "") || leadInMessage(ctx.leads, text);
  if (!lead) return { kind: "answer", reply: "¿De quién es ese pago? Dime el nombre del lead." };
  const pending = ctx.pending;
  if (
    pending?.leadId === lead.id &&
    pending.changes.some((change) => change.field === "cash" && change.to === "0")
  ) {
    return {
      kind: "confirm",
      reply: confirmReply(pending.leadName || lead.name, pending.changes),
      proposal: pending,
    };
  }
  const current = lead.amountPaid || "—";
  if (current === "0") {
    return { kind: "answer", reply: `${lead.name} ya está en 0 de cobrado.` };
  }
  const proposal: ChatProposal = {
    leadId: lead.id,
    leadName: lead.name,
    changes: [{ field: "cash", label: "Cobrado", from: current, to: "0" }],
  };
  return { kind: "confirm", reply: confirmReply(lead.name, proposal.changes), proposal };
}

function offerEdit(text: string, ctx: ChatContext): ChatTurn | null {
  const match =
    text.match(
      /^(?:la oferta|el producto)(?:\s+de\s+(.+?))?\s+(?:es|queda|queda en|ser[aá])\s+(.+)$/i,
    ) || text.match(/^(.+?)\s+(?:tiene|va por|quiere)\s+(?:la oferta|el producto)\s+(.+)$/i);
  if (!match) return null;
  const rawOffer = tidyName(match[2] || "");
  if (!rawOffer) return null;
  const lead = leadInMessage(ctx.leads, match[1] || "") || leadInMessage(ctx.leads, text);
  const offers = offerList(ctx);
  const exact = exactOfferName(offers, rawOffer);
  const names = offers.join(", ") || "ninguna";
  if (!exact) {
    return {
      kind: "answer",
      reply: `«${rawOffer}» no es una oferta. Las tuyas son: ${names}. No cambié nada.`,
    };
  }
  if (!lead) return { kind: "answer", reply: "¿De quién es esa oferta? Dime el nombre del cliente." };
  if (fold(exact) === fold(lead.offerName)) {
    return { kind: "answer", reply: `${lead.name} ya está en ${exact}.` };
  }
  const proposal: ChatProposal = {
    leadId: lead.id,
    leadName: lead.name,
    changes: [{ field: "offer", label: "Producto/Oferta", from: lead.offerName, to: exact }],
  };
  return { kind: "confirm", reply: confirmReply(lead.name, proposal.changes), proposal };
}

function askFacts(text: string, ctx: ChatContext): ChatTurn | null {
  const lead = leadInMessage(ctx.leads, text);
  if (!lead) return null;
  const q = fold(text);
  const asks =
    /[?]/.test(text) ||
    /^(cual|que|cuanto|como)\b/.test(q) ||
    /\b(que oferta|cual es la oferta|cuanto pago|cuanto ha pagado|como se llama)\b/.test(q);
  if (!asks) return null;
  if (/oferta|producto/.test(q)) {
    return {
      kind: "answer",
      reply: lead.offerName
        ? `${lead.name} está en ${lead.offerName}.`
        : `No tengo una oferta guardada para ${lead.name}.`,
    };
  }
  if (/pag|cash|reserva/.test(q)) {
    return {
      kind: "answer",
      reply: lead.amountPaid
        ? `${lead.name} tiene ${lead.amountPaid} cobrado.`
        : `No tengo un pago guardado de ${lead.name}.`,
    };
  }
  if (/acuerdo|qued|siguiente|proximo|seguimiento|transcript|transcrip/.test(q)) {
    return recall(text, ctx);
  }
  const bits = [
    lead.offerName ? `Oferta: ${lead.offerName}.` : "",
    lead.nextStep ? `Acuerdo: ${lead.nextStep}.` : "Sin acuerdo guardado.",
    lead.amountPaid ? `Cobrado: ${lead.amountPaid}.` : "",
  ].filter(Boolean);
  return { kind: "answer", reply: `${lead.name}. ${bits.join(" ")}` };
}

/** Read the current message only. Never writes. A later "sí" applies the stored proposal. */
export function interpretCrmChat(text: string, ctx: ChatContext): ChatTurn {
  const raw = text.trim();
  if (!raw) return { kind: "none" };
  if (isYes(raw)) {
    if (!ctx.pending) {
      return {
        kind: "answer",
        reply: "No tengo ningún cambio pendiente. ¿Qué quieres actualizar?",
      };
    }
    return { kind: "apply", proposal: ctx.pending };
  }
  if (ctx.pending && isNo(raw)) {
    return { kind: "drop", reply: "Listo, cancelé eso. No cambié nada." };
  }
  const desk = pendingDesk(raw, ctx);
  if (desk) return desk;
  return (
    rename(raw, ctx) ||
    offerEdit(raw, ctx) ||
    recall(raw, ctx) ||
    schedule(raw, ctx) ||
    clearPayment(raw, ctx) ||
    payment(raw, ctx) ||
    askFacts(raw, ctx) ||
    { kind: "none" }
  );
}

export function replyForNamedLead(reply: string, message: string, leads: ChatLead[]) {
  const named = leadInMessage(leads, message);
  const text = reply.trim();
  if (!named || !text) return text;
  const first = fold(named.name).split(" ")[0] || fold(named.name);
  if (first && fold(text).includes(first)) return text;
  const other = leads.find((lead) => {
    if (lead.id === named.id) return false;
    const token = fold(lead.name).split(" ")[0] || "";
    return token.length >= 4 && fold(text).includes(token);
  });
  if (!other) return text;
  return `Hablas de ${named.name}. Dime qué dato o qué cambio quieres de ${named.name}.`;
}

export function proposalFromLoosePatch(
  patch: LooseCrmPatch | null | undefined,
  ctx: ChatContext,
  message: string,
): ChatTurn {
  if (!patch) return { kind: "none" };
  const lead = leadInMessage(ctx.leads, message);
  const offers = offerList(ctx);
  const rawOffer = String(patch.offerName || "").trim();
  const exactOffer = rawOffer ? exactOfferName(offers, rawOffer) : "";
  const names = offers.join(", ") || "ninguna";
  if (!lead) {
    if (rawOffer && !exactOffer) {
      return {
        kind: "answer",
        reply: `«${rawOffer}» no es una oferta. Las tuyas son: ${names}. No cambié nada.`,
      };
    }
    if (patch.name || patch.nextStep || patch.amountPaid || patch.lastSummary || exactOffer) {
      return { kind: "answer", reply: "¿De quién? Dime el nombre del cliente." };
    }
    return { kind: "none" };
  }
  const changes: ChatChange[] = [];
  let warning = "";
  if (rawOffer && !exactOffer) {
    warning = `«${rawOffer}» no es una oferta. Las tuyas son: ${names}. `;
  } else if (exactOffer && fold(exactOffer) !== fold(lead.offerName)) {
    changes.push({
      field: "offer",
      label: "Producto/Oferta",
      from: lead.offerName,
      to: exactOffer,
    });
  }
  const renamed = tidyName(String(patch.name || ""));
  const shown = shownCrmName(lead);
  if (renamed && renamed !== shown && fold(message).includes(fold(renamed))) {
    changes.push({ field: "name", label: "Nombre", from: shown, to: renamed });
  }
  const step = tidyName(String(patch.nextStep || ""));
  if (step && fold(step) !== fold(lead.nextStep) && fold(step) !== fold(rawOffer)) {
    changes.push({ field: "nextStep", label: "Acuerdo", from: lead.nextStep, to: step });
  }
  const when = String(patch.nextStepAt || "").trim();
  if (when && /^\d{4}-\d{2}-\d{2}/.test(when)) {
    changes.push({ field: "nextStepAt", label: "Próximo seguimiento", from: "", to: when });
  }
  const cash = patch.amountPaid ? parseMoney(String(patch.amountPaid)) : null;
  if (cash) {
    const current = paidNow(lead.amountPaid);
    const cuota = /cuota/i.test(message);
    const next = cuota ? current + Number(cash) : Number(cash);
    if (!(cuota === false && current === next)) {
      changes.push({
        field: "cash",
        label: "Cobrado",
        from: String(current),
        to: String(next),
      });
    }
  }
  const notes = tidyName(String(patch.lastSummary || ""));
  if (notes && fold(notes) !== fold(lead.lastSummary) && fold(notes) !== fold(rawOffer)) {
    changes.push({ field: "notes", label: "Notas", from: lead.lastSummary, to: notes });
  }
  if (!changes.length) {
    if (warning) return { kind: "answer", reply: `${warning}No cambié nada.`.trim() };
    return { kind: "none" };
  }
  const proposal: ChatProposal = { leadId: lead.id, leadName: shownCrmName(lead), changes };
  return {
    kind: "confirm",
    reply: `${warning}${confirmReply(shownCrmName(lead), changes)}`.trim(),
    proposal,
  };
}

function asChange(value: unknown): ChatChange | null {
  if (!value || typeof value !== "object") return null;
  const row = value as ChatChange;
  if (!CHANGE_FIELDS.includes(row.field)) return null;
  if (typeof row.to !== "string" || !row.to.trim()) return null;
  return {
    field: row.field,
    label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : row.field,
    from: typeof row.from === "string" ? row.from : "",
    to: row.to.trim(),
  };
}

export function readPendingChat(prefs: unknown): ChatProposal | null {
  if (!prefs || typeof prefs !== "object") return null;
  const raw = (prefs as Record<string, unknown>).pendingChat;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as ChatProposal;
  if (typeof row.leadId !== "string" || !row.leadId.trim()) return null;
  const conversation = (row as { conversation?: unknown }).conversation;
  if (typeof conversation === "string" && conversation !== "hub") return null;
  if (!Array.isArray(row.changes)) return null;
  const changes = row.changes.map(asChange).filter((change): change is ChatChange => Boolean(change));
  if (!changes.length) return null;
  const applyKey = (row as { applyKey?: unknown }).applyKey;
  return {
    leadId: row.leadId,
    leadName: typeof row.leadName === "string" ? row.leadName : "",
    changes,
    ...(typeof applyKey === "string" && applyKey.trim() ? { applyKey } : {}),
  };
}

export async function savePendingChat(
  prisma: PrismaClient,
  userId: string,
  proposal: ChatProposal | null,
) {
  await patchCrmPref(
    prisma,
    userId,
    "pendingChat",
    proposal ? { ...proposal, conversation: "hub" } : undefined,
  );
}

export function chatFailureReply(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/transaction|updateMany|interactive transaction/i.test(message)) {
    return "No pude guardar porque la base rechazó una operación en lote. El chat sigue activo: confirma otra vez.";
  }
  if (/timeout|tard[oó]|abort|gemini/i.test(message)) {
    return "Tardó demasiado y no guardé ese cambio. Escribe otra vez; no hace falta recargar.";
  }
  return "No pude completar eso. El chat sigue activo: inténtalo otra vez.";
}

function plainFiling(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const filing: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item !== undefined) filing[key] = item;
  }
  return filing;
}

export async function applyChatProposal(
  prisma: PrismaClient,
  userId: string,
  proposal: ChatProposal,
  offers: string[] = [],
): Promise<{ ok: boolean; reply: string; remember?: boolean }> {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: proposal.leadId, userId },
    });
    if (!lead) return { ok: true, reply: "No encontré ese lead. No cambié nada." };
    const data: {
      name?: string;
      nextStep?: string;
      nextStepAt?: Date;
      amountPaid?: string;
      offerName?: string;
      lastSummary?: string;
    } = {};
    let nextName = lead.name;
    let skippedOffer = "";
    let cashChange: ChatChange | null = null;
    let cashSkipNote = "";
    let cashRemember = true;
    const nameChange = proposal.changes.find((change) => change.field === "name");
    const fromName = nameChange?.from?.trim() || lead.name;
    for (const change of proposal.changes) {
      const to = typeof change.to === "string" ? change.to.trim() : "";
      if (!to && change.field !== "cash") continue;
      if (change.field === "name") {
        nextName = to;
        if (to !== lead.name) data.name = nextName;
      }
      if (change.field === "nextStep") data.nextStep = to;
      if (change.field === "nextStepAt") {
        const iso = to.includes("T") ? to : to.replace(" ", "T");
        const date = new Date(iso.length === 16 ? `${iso}:00.000Z` : iso);
        if (!Number.isNaN(date.getTime())) data.nextStepAt = date;
      }
      if (change.field === "cash") cashChange = { ...change, to };
      if (change.field === "notes") data.lastSummary = to;
      if (change.field === "offer") {
        const exact = exactOfferName(offers, to);
        if (!exact) skippedOffer = to;
        else data.offerName = exact;
      }
    }
    if (cashChange && cashChange.to.trim()) {
      const target = paidNow(cashChange.to);
      let callCash: number | null = null;
      try {
        const preview = await prisma.callRecord.findFirst({
          where: { userId, leadName: nextName },
          orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
        });
        if (preview) callCash = cashNumber(preview);
      } catch (error) {
        console.error("read cobrado", error);
      }
      const stored = String(lead.amountPaid ?? "").trim();
      const leadCash = stored ? paidNow(stored) : null;
      const current = callCash != null ? callCash : leadCash;
      const from =
        cashChange.from && cashChange.from !== "—" ? paidNow(cashChange.from) : null;
      if (current != null && current === target) {
        cashSkipNote = `Cobrado de ${nextName} ya está en ${formatMoneyEs(target)}. No lo sumé otra vez.`;
      } else if (current != null && from != null && from !== current) {
        cashSkipNote = `Cobrado de ${nextName} ahora está en ${formatMoneyEs(current)}. No lo sumé otra vez.`;
        cashRemember = false;
      } else {
        data.amountPaid = String(target);
      }
    }
    const callsNeedRename = Boolean(nameChange && fromName !== nextName);
    if (!Object.keys(data).length && !callsNeedRename) {
      if (cashSkipNote) return { ok: true, reply: cashSkipNote, remember: cashRemember };
      const because = skippedOffer
        ? `«${skippedOffer}» no es una oferta. No cambié nada.`
        : "No hay un cambio válido para guardar. No cambié nada.";
      return { ok: true, reply: because };
    }
    if (Object.keys(data).length) {
      await prisma.lead.update({ where: { id: lead.id }, data });
    }
    let callNote = "";
    if (callsNeedRename) {
      try {
        const updated = await renameCrmCalls(prisma, userId, {
          fromNames: [fromName, lead.name],
          next: nextName,
        });
        if (updated < 1) callNote = " No encontré una llamada con el nombre anterior.";
      } catch (error) {
        console.error("rename lead calls", error);
        callNote = " No pude renombrar las llamadas vinculadas.";
      }
    }
    try {
      const call = await prisma.callRecord.findFirst({
        where: { userId, leadName: callNote ? lead.name : nextName },
        orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
      });
      if (call) {
        const filing = plainFiling(call.filingJson);
        if (callsNeedRename) filing.cliente_real = nextName;
        const step = proposal.changes.find((change) => change.field === "nextStep");
        const when = proposal.changes.find((change) => change.field === "nextStepAt");
        const note = proposal.changes.find((change) => change.field === "notes");
        if (step) filing.acuerdo_seguimiento = step.to;
        if (when) filing.proximo_seguimiento = when.to;
        if (note) filing.notas_crm = note.to;
        const cashAmount = data.amountPaid != null ? Number(data.amountPaid) : null;
        if (cashAmount != null && Number.isFinite(cashAmount)) filing.cash_collected = cashAmount;
        await prisma.callRecord.update({
          where: { id: call.id },
          data: {
            leadName: nextName,
            ...(data.offerName ? { offerName: data.offerName } : {}),
            ...(cashAmount != null && Number.isFinite(cashAmount)
              ? { cashCollected: cashAmount }
              : {}),
            filingJson: filing as Prisma.InputJsonValue,
          },
        });
      }
    } catch (error) {
      console.error("sync lead call", error);
      callNote = `${callNote} No pude actualizar la llamada vinculada.`.trim();
    }
    const done = proposal.changes
      .filter((change) => change.field !== "offer" || !skippedOffer)
      .filter((change) => change.field !== "cash" || data.amountPaid != null)
      .map((change) => `${change.label} «${change.to}»`)
      .join("; ");
    const offerNote = skippedOffer
      ? ` No toqué Producto/Oferta: «${skippedOffer}» no está en tus ofertas.`
      : "";
    const cashNote = cashSkipNote ? ` ${cashSkipNote}` : "";
    return {
      ok: true,
      remember: cashChange ? Boolean(data.amountPaid) || cashRemember : undefined,
      reply: `Listo. En ${nextName} quedó: ${done}.${offerNote}${cashNote}${callNote ? ` ${callNote}` : ""}`.replace(
        /\s+/g,
        " ",
      ).trim(),
    };
  } catch (error) {
    console.error("applyChatProposal", error);
    return { ok: false, reply: chatFailureReply(error) };
  }
}

function usableTranscript(text: string | null | undefined) {
  const value = String(text || "").trim();
  if (!value || value === EMPTY_TRANSCRIPT_MARK || value.length < 40) return "";
  return value;
}

export async function loadLeadTranscript(
  prisma: PrismaClient,
  userId: string,
  leadName: string,
  calls: { leadName: string; source?: string; sourceId?: string }[] = [],
) {
  try {
    const folded = fold(leadName);
    const linked = calls.filter(
      (call) => fold(call.leadName) === folded && call.sourceId && call.source !== "chat",
    );
    for (const call of linked) {
      const id = String(call.sourceId || "");
      if (!id) continue;
      if (call.source === "fathom" || !call.source) {
        const row = await prisma.fathomRecording.findFirst({
          where: { id, userId },
          select: { transcriptText: true },
        });
        const text = usableTranscript(row?.transcriptText);
        if (text) return text;
      }
      if (call.source === "upload" || call.source === "qc" || !call.source) {
        const row = await prisma.clientTranscript.findFirst({
          where: { id, userId },
          select: { transcriptText: true },
        });
        const text = usableTranscript(row?.transcriptText);
        if (text) return text;
      }
    }
    const [uploads, fathom] = await Promise.all([
      prisma.clientTranscript.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { id: true, title: true },
      }),
      prisma.fathomRecording.findMany({
        where: { userId },
        orderBy: [{ recordedAt: "desc" }, { syncedAt: "desc" }],
        take: 40,
        select: { id: true, title: true },
      }),
    ]);
    const titled = [...uploads, ...fathom].find((row) => {
      const title = fold(row.title);
      return title.length >= 3 && (title.includes(folded) || folded.includes(title));
    });
    if (!titled) return "";
    const upload = uploads.find((row) => row.id === titled.id);
    if (upload) {
      const full = await prisma.clientTranscript.findFirst({
        where: { id: upload.id, userId },
        select: { transcriptText: true },
      });
      return usableTranscript(full?.transcriptText);
    }
    const full = await prisma.fathomRecording.findFirst({
      where: { id: titled.id, userId },
      select: { transcriptText: true },
    });
    return usableTranscript(full?.transcriptText);
  } catch (error) {
    console.error("loadLeadTranscript", error);
    return "";
  }
}

export async function respondToCrmChat(
  prisma: PrismaClient,
  userId: string,
  text: string,
  ctx: ChatContext,
) {
  const turn = interpretCrmChat(text, ctx);
  if (turn.kind === "none") return null;
  try {
    if (turn.kind === "confirm") {
      await savePendingChat(prisma, userId, turn.proposal);
      return turn.reply;
    }
    if (turn.kind === "apply") {
      const result = await applyChatProposal(prisma, userId, turn.proposal, ctx.offers || []);
      if (result.ok) await savePendingChat(prisma, userId, null);
      const cash = turn.proposal.changes.find((change) => change.field === "cash");
      if (result.ok && result.remember !== false && turn.proposal.applyKey && cash) {
        await patchCrmPref(prisma, userId, "lastCashApply", {
          leadId: turn.proposal.leadId,
          key: turn.proposal.applyKey,
          to: cash.to,
        });
      }
      return result.reply;
    }
    if (turn.kind === "drop") {
      await savePendingChat(prisma, userId, null);
      return turn.reply;
    }
    if (ctx.pending) await savePendingChat(prisma, userId, null);
    return ctx.pending ? `Dejé sin confirmar el cambio anterior. ${turn.reply}` : turn.reply;
  } catch (error) {
    console.error("respondToCrmChat", error);
    return chatFailureReply(error);
  }
}

export async function answerCrmChat(prisma: PrismaClient, userId: string, text: string) {
  const raw = text.trim();
  if (!raw) return null;
  if (
    raw.length > 280 &&
    !/\b(se llama|transcript|transcrip|quedamos|pag[oó]|oferta|producto|recuerdo|cash|borra|nada)\b/i.test(
      raw,
    )
  ) {
    return null;
  }
  const [user, leadRows, callRows, offerRows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { crmPrefs: true } }),
    prisma.lead.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        offerName: true,
        nextStep: true,
        lastSummary: true,
        amountPaid: true,
      },
    }),
    prisma.callRecord.findMany({
      where: { userId, filingStatus: { not: "skipped" } },
      orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
      take: 2000,
      select: {
        leadName: true,
        title: true,
        summary: true,
        filingJson: true,
        source: true,
        sourceId: true,
        cashCollected: true,
      },
    }),
    prisma.userOffer.findMany({
      where: { userId },
      select: { productName: true },
    }),
  ]);
  const leads: ChatLead[] = leadRows.map((row) => ({
    id: row.id,
    name: row.name,
    offerName: row.offerName,
    nextStep: row.nextStep,
    lastSummary: row.lastSummary,
    amountPaid: row.amountPaid,
  }));
  const desk = deskLinesFromFilings(
    callRows.map((row) => {
      const filing = (row.filingJson || {}) as {
        acuerdo_seguimiento?: string;
        tipo_seguimiento?: string;
        proximo_seguimiento?: string;
        seguimiento_resultado?: string;
        estado_agenda?: string;
        venta_total?: number | null;
        cash_collected?: number | null;
        saldo_pendiente?: number | null;
      };
      const proximo = String(filing.proximo_seguimiento || "");
      const venta = Number(filing.venta_total);
      const cash = Number(filing.cash_collected);
      const saldo = Number(filing.saldo_pendiente);
      return {
        name: callClientName(row) || row.leadName,
        proximo,
        step: String(filing.acuerdo_seguimiento || filing.tipo_seguimiento || ""),
        closed: followupIsClosed({
          seguimiento_resultado: filing.seguimiento_resultado,
          proximo_seguimiento: proximo,
        }),
        estadoAgenda: String(filing.estado_agenda || ""),
        venta: Number.isFinite(venta) ? venta : null,
        cash: Number.isFinite(cash) ? cash : null,
        saldo: Number.isFinite(saldo) ? saldo : null,
      };
    }),
    zonedDayKey(new Date()),
  );
  const calls: ChatCall[] = callRows.map((row) => {
    const filing = (row.filingJson || {}) as {
      acuerdo_seguimiento?: string;
      notas_crm?: string;
      proximo_seguimiento?: string;
    };
    return {
      leadName: callClientName(row) || row.leadName,
      acuerdo: String(filing.acuerdo_seguimiento || ""),
      notas: String(filing.notas_crm || row.summary || ""),
      proximo: String(filing.proximo_seguimiento || "").replace("T", " ").slice(0, 16),
    };
  });
  for (const lead of leads) {
    const shown = crmDisplayedName(
      lead.name,
      callRows.map((row) => callClientName(row)).filter(Boolean),
    );
    if (shown && shown !== lead.name) lead.crmName = shown;
    const collected = cobradoFromCalls(shown || lead.name, callRows);
    if (collected != null) lead.amountPaid = String(collected);
  }
  if (mentionsLeadMemory(raw)) {
    const lead = leadInMessage(leads, raw);
    if (lead) {
      const transcript = await loadLeadTranscript(prisma, userId, lead.name, callRows);
      if (transcript) {
        const index = calls.findIndex((call) => fold(call.leadName) === fold(lead.name));
        if (index >= 0) calls[index] = { ...calls[index], transcript };
        else {
          calls.unshift({
            leadName: lead.name,
            acuerdo: lead.nextStep,
            notas: lead.lastSummary,
            proximo: "",
            transcript,
          });
        }
      }
    }
  }
  const ctx: ChatContext = {
    leads,
    calls,
    pending: readPendingChat(user?.crmPrefs),
    now: new Date(),
    offers: offerRows.map((row) => row.productName).filter(Boolean),
    desk,
    appliedCash: readAppliedCash(user?.crmPrefs),
  };
  const turn = interpretCrmChat(raw, ctx);
  if (turn.kind === "none") return null;
  return respondToCrmChat(prisma, userId, raw, ctx);
}
