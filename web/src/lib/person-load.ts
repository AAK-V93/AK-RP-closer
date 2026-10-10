import type { PrismaClient } from "@prisma/client";
import { isNonSalesCall } from "@/lib/call-kind";
import { offerRules } from "@/lib/inicio-view";
import { foldOffer } from "@/lib/offer-name";
import { normalizePersonName, samePersonName } from "@/lib/lead-match";
import { buildPersonFacts, callNamesSomeoneElse, callsForPerson, stageMapByLead, type FactCall, type FactLead, type PersonFacts } from "@/lib/person-facts";

/** Read-only loads for the ficha and the chat. Nothing here writes. */

export type PersonRef = { id: string; name: string; leadId: string };

type Loaded = { leads: FactLead[]; calls: FactCall[] };

export async function loadPeople(prisma: PrismaClient, userId: string): Promise<Loaded> {
  const [leads, calls] = await Promise.all([
    prisma.lead.findMany({
      where: { userId },
      select: {
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
    }),
    prisma.callRecord.findMany({
      where: { userId, filingStatus: { not: "skipped" } },
      orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
      take: 2000,
      select: {
        id: true,
        source: true,
        sourceId: true,
        leadName: true,
        offerName: true,
        estadoAgenda: true,
        recordedAt: true,
        createdAt: true,
        summary: true,
        filingJson: true,
        ventaTotal: true,
        cashCollected: true,
        saldoPendiente: true,
        modoPago: true,
      },
    }),
  ]);
  return {
    leads,
    calls: calls.filter((call) => {
      const filing = (call.filingJson || {}) as { estado_agenda?: string };
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
    loadPeople(prisma, userId),
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
