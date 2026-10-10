import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { generateGeminiJson } from "@/lib/gemini";
import { answerAboutPerson, chatPrompt, decideChatTurn, factsForModel, groundedReply } from "@/lib/crm-chat";
import { loadPeople, loadPersonFacts, peopleIndex } from "@/lib/person-load";

type Body = {
  message?: string;
  contextId?: string | null;
  leadId?: string | null;
  history?: { role: "user" | "crm"; text: string }[];
};

const MODEL_TIMEOUT_MS = 6_000;

/**
 * Questions about one person, answered from that person's rows. List questions
 * come back as «list» so the panel answers them from the follow-ups it already
 * has. Never writes: changes still go through /api/hub and «Guardar».
 */
export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json().catch(() => ({}))) as Body;
    const text = String(body.message || "").trim();
    if (!text) return NextResponse.json({ error: "Escribe algo" }, { status: 400 });
    const loaded = await loadPeople(auth.prisma, auth.userId);
    const people = peopleIndex(loaded);
    const decision = decideChatTurn({ text, contextId: body.contextId, leadId: body.leadId }, people);
    if (decision.kind === "list") return NextResponse.json({ kind: "list" });
    if (decision.kind === "ask") {
      return NextResponse.json({ kind: "answer", reply: decision.reply, contextId: body.contextId || null });
    }
    const now = new Date();
    const facts = await loadPersonFacts(auth.prisma, auth.userId, loaded, decision.person, now);
    const draft = answerAboutPerson(facts, decision.topic, now);
    let reply = draft;
    if (process.env.GEMINI_API_KEY?.trim() && process.env.CRM_CHAT_MODEL !== "off") {
      try {
        const modelFacts = factsForModel(facts, now);
        const raw = await generateGeminiJson(
          chatPrompt({ question: text, history: Array.isArray(body.history) ? body.history : [], facts: modelFacts, draft }),
          0.3,
          300,
          { timeoutMs: MODEL_TIMEOUT_MS, models: ["gemini-flash-lite-latest", "gemini-flash-latest"] },
        );
        const parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, "").trim()) as { reply?: string };
        reply = groundedReply(String(parsed.reply || ""), modelFacts, draft) || draft;
      } catch (error) {
        console.warn("crm ask model", error instanceof Error ? error.message : error);
      }
    }
    return NextResponse.json({
      kind: "answer",
      reply,
      contextId: decision.person.id,
      leadId: decision.person.leadId || null,
      name: decision.person.name,
    });
  } catch (error) {
    console.error("crm ask", error);
    return NextResponse.json({ kind: "answer", reply: "No pude leer el CRM ahora. Inténtalo otra vez." }, { status: 500 });
  }
}
