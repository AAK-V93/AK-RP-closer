import { isNonSalesCall } from "@/lib/call-kind";
import { dueDayFromProximo } from "@/lib/crm-followups";
import { normalizePersonName } from "@/lib/lead-match";
import { foldOffer } from "@/lib/offer-name";
import { countedSale } from "@/lib/stated-deal";

export const SALDO_POR_COBRAR_NOTE =
  "Saldo por cobrar es lo que falta de los cierres: el monto de la venta menos lo cobrado.";

/** Shown even at USD 0 so the card is findable. */
export function saldoPorCobrarNote(amount: number) {
  if (amount > 0) return SALDO_POR_COBRAR_NOTE;
  return `${SALDO_POR_COBRAR_NOTE} Ahora está en USD 0: ningún cierre tiene un monto mayor a lo cobrado.`;
}

/** One line, same on Dashboard and Inicio, including how many leads the sum uses. */
export function dineroEnJuegoNote(count: number) {
  const leads = count === 1 ? "1 lead" : `${count} leads`;
  return `Suma el precio de cada lead abierto (ni Cerró ni Perdido), una persona una vez. Usa el precio hablado o la venta de la última llamada. Si no hay monto y el lead tiene una oferta, usa el de lista o el de contado de esa oferta. Una oferta solo mencionada, o copiada de un precio, no entra. Cuenta ${leads}.`;
}

export type PipelineFuente = "hablado" | "venta" | "lista" | "contado" | "ninguno";

export type PipelineLine = {
  name: string;
  amount: number;
  fuente: string;
};

export function pipelineFuente(source: PipelineFuente, offer = "") {
  if (source === "hablado") return "precio hablado";
  if (source === "venta") return "venta de la última llamada";
  if (source === "lista") return `precio de lista de ${offer}`;
  if (source === "contado") return `precio de contado de ${offer}`;
  return "sin precio";
}

export function sinPrecioNote(count: number) {
  if (count === 1) return "1 sin precio";
  return `${count} sin precio`;
}

/** Priced leads stay as lines. The rest collapse into one «N sin precio» row. */
export function pipelineDetailGroups(lines: PipelineLine[]) {
  const priced: PipelineLine[] = [];
  const unpriced: PipelineLine[] = [];
  for (const row of lines) {
    if (row.amount > 0) priced.push(row);
    else unpriced.push(row);
  }
  return { priced, unpriced };
}

const ACTIVE_STAGES = new Set([
  "DECISION",
  "RETOMAR",
  "SEGUNDA REUNION",
  "REAGENDAR",
  "SEGUIMIENTO",
  "PENDIENTE",
]);

const CLOSED_STATUS = new Set(["cerrado", "cerro", "cobro"]);
const CLOSED_ESTADO = new Set(["CIERRE VENTA", "ACUERDO SIN PAGO"]);

export function isActiveOpenStage(stage: string | null | undefined) {
  const raw = String(stage || "")
    .trim()
    .toUpperCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
  if (!raw) return false;
  if (
    raw === "CIERRE VENTA" ||
    raw === "CERRADO" ||
    raw === "CERRO" ||
    raw === "PERDIDO" ||
    raw === "COBRANZA" ||
    raw === "COBRO" ||
    raw === "ACUERDO SIN PAGO"
  ) {
    return false;
  }
  return ACTIVE_STAGES.has(raw);
}

export type DealValueInput = {
  price?: number | null;
  listPrice?: number | null;
  cashPrice?: number | null;
  at?: Date | string | null;
};

/** Lead price, otherwise the product list price, otherwise the cash price. */
export function expectedDealValue(row: DealValueInput) {
  const catalog = [row.listPrice, row.cashPrice].filter(
    (amount): amount is number => amount != null && amount > 0,
  );
  const own = countedSale(row.price, { at: row.at, prices: catalog });
  if (own) return own;
  const list = countedSale(row.listPrice, { at: row.at, prices: catalog });
  if (list) return list;
  return countedSale(row.cashPrice, { at: row.at, prices: catalog });
}

export type OpenLeadInput = DealValueInput & {
  person: string;
  closed?: boolean;
  lost?: boolean;
  nextFollowup?: boolean;
  stage?: string | null;
  source?: PipelineFuente;
  offerLabel?: string;
};

/**
 * Open pipeline: one expected deal per person who is still open
 * (not Cerró, not Perdido) and has a next follow-up or an active stage.
 */
export function openPipeline(rows: OpenLeadInput[]) {
  const ordered = [...rows].sort(
    (a, b) => Number(Boolean(b.closed || b.lost)) - Number(Boolean(a.closed || a.lost)),
  );
  const seen = new Set<string>();
  let total = 0;
  let count = 0;
  const lines: PipelineLine[] = [];
  for (const row of ordered) {
    const key = normalizePersonName(row.person);
    if (!key || seen.has(key)) continue;
    if (row.closed || row.lost) {
      seen.add(key);
      continue;
    }
    if (!row.nextFollowup && !isActiveOpenStage(row.stage)) continue;
    seen.add(key);
    const amount = expectedDealValue(row);
    count += 1;
    total += amount;
    const source = row.source || (amount > 0 ? "lista" : "ninguno");
    lines.push({
      name: row.person,
      amount,
      fuente: pipelineFuente(source, row.offerLabel || ""),
    });
  }
  lines.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "es"));
  return { total, count, lines };
}

export type ClosedDealInput = {
  person: string;
  closed: boolean;
  sale?: number | null;
  collected?: number | null;
  at?: Date | string | null;
};

/** Sale minus Cobrado, once per person, only on closed deals. */
export function saldoPorCobrar(rows: ClosedDealInput[]) {
  const seen = new Set<string>();
  let total = 0;
  for (const row of rows) {
    const key = normalizePersonName(row.person);
    if (!row.closed || !key || seen.has(key)) continue;
    seen.add(key);
    const prices = [row.sale, row.collected].filter(
      (amount): amount is number => amount != null && amount > 0,
    );
    const sale = countedSale(row.sale, { at: row.at, prices });
    const collected = countedSale(row.collected, { at: row.at, prices });
    const due = sale - collected;
    if (due > 0) total += due;
  }
  return total;
}

type PipelineOffer = {
  productName: string;
  aliases?: string[];
  listPrice: number | null;
  altPrices?: { label: string; amount: number | null }[];
};

type PipelineCall = {
  leadName?: string | null;
  offerName?: string | null;
  estadoAgenda?: string | null;
  ventaTotal?: number | null;
  cashCollected?: number | null;
  recordedAt?: Date | string | null;
  createdAt?: Date | string | null;
  filingJson?: unknown;
};

type PipelineLead = {
  id: string;
  name: string;
  status: string;
  offerName: string;
  amountTalked: string;
  nextStepAt?: Date | string | null;
};

type PipelineThread = {
  leadId: string;
  tipo: string;
  estado: string;
};

function cashPriceOf(offer: PipelineOffer) {
  const amounts = (offer.altPrices || [])
    .filter((row) => row.amount != null && row.amount > 0 && /contado|cash|efectivo/i.test(row.label))
    .map((row) => row.amount as number);
  if (!amounts.length) return null;
  return Math.min(...amounts);
}

function offerPricesFor(name: string, offers: PipelineOffer[]) {
  const needle = foldOffer(name);
  const empty = { listPrice: null as number | null, cashPrice: null as number | null, productName: "" };
  if (!needle) return empty;
  const hit = offers.find((offer) =>
    [offer.productName, ...(offer.aliases || [])]
      .map((value) => foldOffer(value))
      .filter((value) => value && !value.startsWith("lista usd"))
      .some((value) => value === needle),
  );
  if (!hit) return empty;
  return { listPrice: hit.listPrice, cashPrice: cashPriceOf(hit), productName: hit.productName };
}

function pricedDeal(args: {
  talked: number | null;
  sale: number | null;
  listPrice: number | null;
  cashPrice: number | null;
  offerName: string;
  at?: Date | string | null;
}): { amount: number; source: PipelineFuente } {
  const catalog = [args.listPrice, args.cashPrice].filter(
    (amount): amount is number => amount != null && amount > 0,
  );
  const talked = countedSale(args.talked, { at: args.at, prices: catalog });
  if (talked) return { amount: talked, source: "hablado" };
  const sale = countedSale(args.sale, { at: args.at, prices: catalog });
  if (sale) return { amount: sale, source: "venta" };
  if (!args.offerName) return { amount: 0, source: "ninguno" };
  const list = countedSale(args.listPrice, { at: args.at, prices: catalog });
  if (list) return { amount: list, source: "lista" };
  const cash = countedSale(args.cashPrice, { at: args.at, prices: catalog });
  if (cash) return { amount: cash, source: "contado" };
  return { amount: 0, source: "ninguno" };
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function textOf(value: unknown) {
  return String(value ?? "").trim();
}

function parseTalked(raw: string) {
  const text = raw.trim();
  if (!text) return null;
  const normalized = /^\d{1,3}(\.\d{3})+$/.test(text)
    ? text.replace(/\./g, "")
    : text.replace(/[^\d.,]/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function callInstant(call: PipelineCall) {
  const raw = call.recordedAt || call.createdAt;
  if (!raw) return 0;
  const time = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function samePerson(stored: string, shown: string) {
  const a = normalizePersonName(stored);
  const b = normalizePersonName(shown);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.split(" ").length < 2) return false;
  return longer.startsWith(`${shorter} `);
}

export function summarizePipeline(args: {
  leads: PipelineLead[];
  calls: PipelineCall[];
  threads: PipelineThread[];
  offers: PipelineOffer[];
}) {
  const calls = args.calls
    .filter((call) => !isNonSalesCall(call.estadoAgenda))
    .slice()
    .sort((a, b) => callInstant(b) - callInstant(a));
  const openRows: OpenLeadInput[] = [];
  const closedRows: ClosedDealInput[] = [];

  for (const lead of args.leads) {
    const owned = calls.filter((call) =>
      samePerson(lead.name, textOf(call.leadName) || textOf(asRecord(call.filingJson).cliente_real)),
    );
    const newest = owned[0];
    const filing = asRecord(newest?.filingJson);
    const estado = textOf(newest?.estadoAgenda).toUpperCase();
    const status = textOf(lead.status).toLowerCase();
    const lost = status === "perdido";
    const thread = args.threads.find((row) => row.leadId === lead.id && row.estado === "activo");
    const stage = textOf(thread?.tipo) || textOf(filing.tipo_seguimiento) || lead.status;
    const closed =
      !lost && (CLOSED_STATUS.has(status) || CLOSED_ESTADO.has(estado));
    const nextFollowup = Boolean(
      lead.nextStepAt ||
        dueDayFromProximo(textOf(filing.proximo_seguimiento)) ||
        owned.some((call) => dueDayFromProximo(textOf(asRecord(call.filingJson).proximo_seguimiento))),
    );
    // Only the offer stored on the lead. A call offer or producto can be a
    // price sentence rewritten to the only catalog product, or a mention.
    const priced = offerPricesFor(lead.offerName, args.offers);
    const at = newest?.recordedAt || newest?.createdAt || null;
    const deal = pricedDeal({
      talked: parseTalked(lead.amountTalked),
      sale: newest?.ventaTotal ?? null,
      listPrice: priced.listPrice,
      cashPrice: priced.cashPrice,
      offerName: priced.productName,
      at,
    });
    const person = lead.name;
    openRows.push({
      person,
      closed,
      lost,
      nextFollowup,
      stage,
      price: deal.source === "hablado" || deal.source === "venta" ? deal.amount : null,
      listPrice: deal.source === "lista" ? priced.listPrice : null,
      cashPrice: deal.source === "contado" ? priced.cashPrice : null,
      at,
      source: deal.source,
      offerLabel: priced.productName,
    });
    if (closed) {
      const closedCall =
        owned.find((call) => CLOSED_ESTADO.has(textOf(call.estadoAgenda).toUpperCase())) || newest;
      closedRows.push({
        person,
        closed: true,
        sale: closedCall?.ventaTotal,
        collected: closedCall?.cashCollected,
        at: closedCall?.recordedAt || closedCall?.createdAt || null,
      });
    }
  }

  const pipeline = openPipeline(openRows);
  return {
    pipeline,
    saldo: saldoPorCobrar(closedRows),
    lines: pipeline.lines,
  };
}
