import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { buildPersonFacts, nextLine } from "@/lib/person-facts";
import { findPerson, loadPeople, loadPersonFacts, peopleIndex } from "@/lib/person-load";

/** One ficha for every surface. Read-only. */
export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const url = new URL(request.url);
    const target = {
      leadId: url.searchParams.get("leadId"),
      callId: url.searchParams.get("callId"),
      name: url.searchParams.get("name"),
      day: url.searchParams.get("day"),
    };
    const loaded = await loadPeople(auth.prisma, auth.userId);
    const people = peopleIndex(loaded);
    const person = findPerson(loaded, people, target);
    const now = new Date();
    if (!person) {
      const name = String(target.name || "").trim();
      if (!name) return NextResponse.json({ error: "No encontré a esa persona en tu CRM." }, { status: 404 });
      // An old call that never reached the CRM: say so instead of an empty error.
      const facts = buildPersonFacts({ lead: null, name, calls: [], now, openedFromDay: target.day });
      // Not in the CRM: no follow-ups to count, so no stage line either.
      return NextResponse.json({ ficha: { ...facts, stage: null, personId: "", next: "", inCrm: false } });
    }
    const facts = await loadPersonFacts(auth.prisma, auth.userId, loaded, person, now, target.day);
    return NextResponse.json({ ficha: { ...facts, personId: person.id, next: nextLine(facts, now), inCrm: true } });
  } catch (error) {
    console.error("crm ficha", error);
    return NextResponse.json({ error: "No pude abrir la ficha. Inténtalo otra vez." }, { status: 500 });
  }
}
