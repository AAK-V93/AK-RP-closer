import type { PrismaClient } from "@prisma/client";
import { filingObject, filingSubsetSql } from "@/lib/call-list-sql";
import { cachedCrmRead } from "@/lib/crm-read-cache";
import { isNonSalesCall } from "@/lib/call-kind";
import { offerRules } from "@/lib/inicio-view";
import { foldOffer } from "@/lib/offer-name";
import { normalizePersonName, samePersonName } from "@/lib/lead-match";
import { buildPersonFacts, callNamesSomeoneElse, callsForPerson, stageMapByLead, type FactCall, type FactLead, type PersonFacts } from "@/lib/person-facts";

/** Read-only loads for the ficha and the chat. Nothing here writes. */

export type PersonRef = { id: string; name: string; leadId: string };

type Loaded = { leads: FactLead[]; calls: FactCall[] };

/** Calls read for one person's ficha / the chat (newest first, safety cap). */
export const PEOPLE_CALL_CAP = 2000;

/**
 * Only the filing keys person-facts reads (its `Filing` type), built in Postgres, instead of the
 * whole filingJson (evidence quotes, confidence, undo copies…): ~4× fewer bytes per call.
 */
const FICHA_FILING_SQL = filingSubsetSql([
  "lead_id",
  "cliente_real",
  "producto",
  "estado_agenda",
  "acuerdo_seguimiento",
  "notas_crm",
  "tipo_seguimiento",
  "proximo_seguimiento",
  "razon_no_cierre",
  "modo_pago",
  "venta_total",
  "cash_collected",
  "saldo_pendiente",
  "telefono",
  "seguimiento_resultado",
  "seguimiento_intentos",
  "seguimiento_contactos",
]);

/** The CRM sheets only need who the call belongs to and how it ended (no notes, no summary). */
const STAGE_FILING_SQL = filingSubsetSql([
  "lead_id",
  "cliente_real",
  "estado_agenda",
  "proximo_seguimiento",
  "razon_no_cierre",
  "seguimiento_resultado",
  "seguimiento_intentos",
  "seguimiento_contactos",
]);

type PeopleCallRow = FactCall & { source?: string; sourceId?: string };

/**
 * Leads + their calls for the ficha, the chat and the CRM stages. Reused (short per-instance
 * cache) while no CRM row changed, so opening several fichas in a row reads the calls once.
 */
export async function loadPeople(
  prisma: PrismaClient,
  userId: string,
  options: { forStages?: boolean } = {},
): Promise<Loaded> {
  const stages = Boolean(options.forStages);
  return cachedCrmRead(prisma, userId, stages ? "people:stages" : "people:ficha", () => readPeople(prisma, userId, stages));
}

async function readPeople(prisma: PrismaClient, userId: string, stages: boolean): Promise<Loaded> {
  const [leads, rawCalls] = await Promise.all([
    prisma.lead.findMany({
      where: { userId },
      select: stages
        ? { id: true, name: true, offerName: true, status: true, razonNoCierre: true }
        : {
            id: true,
            name: true,
            offerName: true,
            status: true,
            telefono: true,
            nextStep: true,
            nextStepAt: true,
            objections: true,
            amountTalked: true,
            amountPaid: true,
            decider: true,
            razonNoCierre: true,
            lastSummary: true,
          },
    }) as Promise<FactLead[]>,
    stages
      ? prisma.$queryRaw<PeopleCallRow[]>`
          SELECT "id", "leadName", "offerName", "estadoAgenda", "recordedAt", "createdAt",
            ${STAGE_FILING_SQL} AS "filingJson"
          FROM "CallRecord"
          WHERE "userId" = ${userId} AND "filingStatus" <> 'skipped'
          ORDER BY "recordedAt" DESC, "createdAt" DESC
          LIMIT ${PEOPLE_CALL_CAP}
        `
      : prisma.$queryRaw<PeopleCallRow[]>`
          SELECT "id", "source", "sourceId", "leadName", "offerName", "estadoAgenda", "recordedAt", "createdAt",
            "summary", "ventaTotal", "cashCollected", "saldoPendiente", "modoPago",
            ${FICHA_FILING_SQL} AS "filingJson"
          FROM "CallRecord"
          WHERE "userId" = ${userId} AND "filingStatus" <> 'skipped'
          ORDER BY "recordedAt" DESC, "createdAt" DESC
          LIMIT ${PEOPLE_CALL_CAP}
        `,
  ]);
  const calls = rawCalls.map((call) => ({ ...call, filingJson: filingObject(call.filingJson) }));
  return {
    leads,
    calls: calls.filter((call) => {
      const filing = call.filingJson as { estado_agenda?: string };
      return !isNonSalesCall(filing.estado_agenda || call.estadoAgenda);
    }),
  };
}

function callName(call: FactCall) {
  const filing = (call.filingJson || {}) as { cliente_real?: string };
  return String(call.leadName || filing.cliente_real || "").trim();
}

/** Leads plus names that only exist on a call. Every person can be tapped. */
export function peopleIndex(loaded: Loaded): PersonRef[] {
  const people: PersonRef[] = loaded.leads
    .filter((lead) => lead.name.trim())
    .map((lead) => ({ id: lead.id, name: lead.name.trim(), leadId: lead.id }));
  const seen = new Set(people.map((person) => normalizePersonName(person.name)));
  for (const call of loaded.calls) {
    const filing = (call.filingJson || {}) as { lead_id?: string };
    const owner = filing.lead_id ? loaded.leads.find((lead) => lead.id === filing.lead_id) : undefined;
    if (owner && !callNamesSomeoneElse(owner.name, callName(call))) continue;
    const name = callName(call);
    const key = normalizePersonName(name);
    if (!key || seen.has(key) || /^sin nombre/.test(key)) continue;
    if (people.some((person) => samePersonName(person.name, name))) continue;
    seen.add(key);
    people.push({ id: `name:${key}`, name, leadId: "" });
  }
  return people;
}

/** The person behind a tap: leadId, a call id (CallRecord or its source id), or a name. */
export function findPerson(
  loaded: Loaded,
  people: PersonRef[],
  target: { leadId?: string | null; callId?: string | null; name?: string | null },
): PersonRef | null {
  if (target.leadId) {
    const hit = people.find((person) => person.leadId === target.leadId);
    // A tap on a call that clearly names someone else opens that call's person, not the lead.
    const tapped = target.callId
      ? loaded.calls.find((row) => row.id === String(target.callId).replace(/^call:/, ""))
      : undefined;
    if (hit && !(tapped && callNamesSomeoneElse(hit.name, callName(tapped)))) return hit;
  }
  if (target.callId) {
    const id = target.callId.replace(/^call:/, "");
    const call = loaded.calls.find((row) => row.id === id || (row as { sourceId?: string }).sourceId === id);
    if (call) {
      const filing = (call.filingJson || {}) as { lead_id?: string };
      const byLead = filing.lead_id ? people.find((person) => person.leadId === filing.lead_id) : null;
      if (byLead && !callNamesSomeoneElse(byLead.name, callName(call))) return byLead;
      const name = callName(call);
      const byName = people.find((person) => samePersonName(person.name, name));
      if (byName) return byName;
    }
  }
  const name = String(target.name || "").trim();
  if (name) {
    const key = normalizePersonName(name);
    const exact = people.filter((person) => normalizePersonName(person.name) === key);
    if (exact.length) return exact[0];
    const close = people.filter((person) => samePersonName(person.name, name));
    if (close.length === 1) return close[0];
  }
  return null;
}

export async function loadPersonFacts(
  prisma: PrismaClient,
  userId: string,
  loaded: Loaded,
  person: PersonRef,
  now = new Date(),
  openedFromDay?: string | null,
): Promise<PersonFacts> {
  const lead = person.leadId ? loaded.leads.find((row) => row.id === person.leadId) || null : null;
  const calls = callsForPerson({ id: person.leadId || person.id, name: person.name }, loaded.calls);
  const [alerts, offers] = await Promise.all([
    person.leadId
      ? prisma.leadAlert.findMany({
          where: { userId, leadId: person.leadId },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            id: true,
            type: true,
            dueAt: true,
            resolvedAt: true,
            resultado: true,
            createdAt: true,
            mensajeSugerido: true,
            enJuego: true,
          },
        })
      : Promise.resolve([]),
    prisma.userOffer.findMany({ where: { userId }, select: { productName: true, commercial: true } }),
  ]);
  const rules = offerRules(offers);
  const facts = buildPersonFacts({ lead, name: person.name, calls, alerts, now, openedFromDay });
  const rule = facts.offer
    ? rules.find((row) => [row.productName, ...row.aliases].some((name) => foldOffer(name) === foldOffer(facts.offer)))
    : null;
  if (!rule?.scripts.length) return facts;
  return buildPersonFacts({ lead, name: person.name, calls, alerts, scripts: rule.scripts, now, openedFromDay });
}

/** «Seguimiento N de 10» per lead for the CRM sheets. Read-only. */
export async function loadStages(prisma: PrismaClient, userId: string) {
  const [loaded, alerts] = await Promise.all([
    loadPeople(prisma, userId, { forStages: true }),
    prisma.leadAlert.findMany({
      where: { userId },
      select: { leadId: true, resolvedAt: true, resultado: true, dueAt: true },
    }),
  ]);
  const map = stageMapByLead({ leads: loaded.leads, calls: loaded.calls, alerts });
  const stages: Record<string, string> = {};
  const stageCounts: Record<string, number | null> = {};
  for (const [key, stage] of Object.entries(map)) {
    stages[key] = stage?.label || "";
    stageCounts[key] = stage ? stage.count : null;
  }
  return { stages, stageCounts };
}
