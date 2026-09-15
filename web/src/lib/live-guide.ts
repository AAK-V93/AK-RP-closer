import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { generateGeminiJson } from "@/lib/gemini";
import { isExtractorJson, parseExtractorJson } from "@/lib/extractor";
import { parsePlaybook } from "@/lib/lead-playbook";

export const LIVE_GUIDE_MIN_CALLS = 15;

export type LiveGuide = {
  updatedAt: string;
  callCount: number;
  ready: boolean;
  offerName: string;
  note: string;
  closingTypes: { type: string; approach: string; closed: number; total: number }[];
  scriptVariations: { leadType: string; variation: string; closed: number; total: number }[];
  winMoments: string[];
  missingInLosses: string[];
  drills: string[];
};

export function emptyLiveGuide(offerName: string, callCount = 0): LiveGuide {
  return {
    updatedAt: new Date().toISOString(),
    callCount,
    ready: false,
    offerName,
    note:
      callCount > 0
        ? `Con ${callCount} llamada${callCount === 1 ? "" : "s"} aún no hay patrón. Hacen falta ${LIVE_GUIDE_MIN_CALLS}–20 reales de esta oferta.`
        : `Todavía no hay llamadas reales de ${offerName || "esta oferta"}. El coach no inventa patrones.`,
    closingTypes: [],
    scriptVariations: [],
    winMoments: [],
    missingInLosses: [],
    drills: [],
  };
}

export function parseLiveGuide(raw: unknown, offerName = ""): LiveGuide {
  const playbook = (raw || {}) as { liveGuide?: Partial<LiveGuide> };
  const value = playbook.liveGuide || (raw as Partial<LiveGuide>) || {};
  if (!value || typeof value !== "object") return emptyLiveGuide(offerName);
  return {
    ...emptyLiveGuide(offerName, Number(value.callCount) || 0),
    ...value,
    offerName: String(value.offerName || offerName),
    ready: Boolean(value.ready),
    closingTypes: Array.isArray(value.closingTypes) ? value.closingTypes : [],
    scriptVariations: Array.isArray(value.scriptVariations) ? value.scriptVariations : [],
    winMoments: Array.isArray(value.winMoments) ? value.winMoments.map(String) : [],
    missingInLosses: Array.isArray(value.missingInLosses)
      ? value.missingInLosses.map(String)
      : [],
    drills: Array.isArray(value.drills) ? value.drills.map(String) : [],
    note: String(value.note || ""),
    updatedAt: String(value.updatedAt || new Date().toISOString()),
    callCount: Number(value.callCount) || 0,
  };
}

export async function loadLiveGuides(prisma: PrismaClient, userId: string) {
  const offers = await prisma.userOffer.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return offers.map((row) => parseLiveGuide(row.playbook, row.productName));
}

export async function refreshLiveGuides(prisma: PrismaClient, userId: string) {
  const offers = await prisma.userOffer.findMany({ where: { userId } });
  if (!offers.length) return [];
  const calls = await prisma.callRecord.findMany({
    where: {
      userId,
      source: { in: ["fathom", "upload", "qc"] },
      filingStatus: { in: ["confirmed", "pending"] },
    },
    orderBy: { recordedAt: "desc" },
    take: 120,
  });

  const guides: LiveGuide[] = [];
  for (const offer of offers) {
    const name = offer.productName.trim();
    const slice = calls.filter((row) => {
      const offerName = row.offerName.trim();
      if (!name) return !offerName;
      return !offerName || offerName.toLowerCase() === name.toLowerCase();
    });
    const guide = await buildGuideForOffer(name, slice, parsePlaybook(offer.playbook));
    const playbook =
      offer.playbook && typeof offer.playbook === "object"
        ? { ...(offer.playbook as Record<string, unknown>), liveGuide: guide }
        : { liveGuide: guide };
    await prisma.userOffer.update({
      where: { id: offer.id },
      data: { playbook: playbook as Prisma.InputJsonValue },
    });
    guides.push(guide);
  }
  return guides;
}

async function buildGuideForOffer(
  offerName: string,
  calls: {
    estadoAgenda: string;
    offerName: string;
    filingJson: unknown;
    summary: string;
    leadName: string;
  }[],
  playbook: ReturnType<typeof parsePlaybook>,
): Promise<LiveGuide> {
  const base = emptyLiveGuide(offerName, calls.length);
  if (calls.length < LIVE_GUIDE_MIN_CALLS) return { ...base, callCount: calls.length };

  const closed = calls.filter((row) => row.estadoAgenda === "CIERRE VENTA");
  const lost = calls.filter(
    (row) =>
      row.estadoAgenda !== "CIERRE VENTA" &&
      (isExtractorJson(row.filingJson)
        ? Boolean(parseExtractorJson(row.filingJson).razon_no_cierre)
        : false),
  );

  const byPay = new Map<string, { closed: number; total: number }>();
  for (const row of calls) {
    const parsed = isExtractorJson(row.filingJson) ? parseExtractorJson(row.filingJson) : null;
    const pay = (parsed?.modo_pago || "sin modo").slice(0, 80);
    const cur = byPay.get(pay) || { closed: 0, total: 0 };
    cur.total += 1;
    if (row.estadoAgenda === "CIERRE VENTA") cur.closed += 1;
    byPay.set(pay, cur);
  }

  const types = playbook.leadTypes.map((item) => item.name).filter(Boolean);
  const byType = new Map<string, { closed: number; total: number }>();
  for (const row of calls) {
    const blob = `${row.summary} ${row.leadName} ${JSON.stringify(row.filingJson)}`.toLowerCase();
    const type =
      types.find((name) => blob.includes(name.toLowerCase())) || "sin tipo claro";
    const cur = byType.get(type) || { closed: 0, total: 0 };
    cur.total += 1;
    if (row.estadoAgenda === "CIERRE VENTA") cur.closed += 1;
    byType.set(type, cur);
  }

  const stats = {
    offerName,
    callCount: calls.length,
    closed: closed.length,
    lost: lost.length,
    byPay: [...byPay.entries()].map(([variation, n]) => ({ variation, ...n })),
    byType: [...byType.entries()].map(([type, n]) => ({ type, ...n })),
    lostReasons: lost
      .map((row) =>
        isExtractorJson(row.filingJson)
          ? parseExtractorJson(row.filingJson).razon_no_cierre
          : "",
      )
      .filter(Boolean)
      .slice(0, 12),
  };

  let generated: Partial<LiveGuide> = {};
  try {
    const raw = await generateGeminiJson(
      `Eres un coach de cierre high-ticket. SOLO usa estas cifras. Si no alcanza para una afirmación, no la inventes.
Responde JSON:
{
  "closingTypes": [{"type":"","approach":"","closed":0,"total":0}],
  "scriptVariations": [{"leadType":"","variation":"contado vs cuotas u otro","closed":0,"total":0}],
  "winMoments": ["frase o momento que aparece en cierres"],
  "missingInLosses": ["qué no aparece en las que se perdieron"],
  "drills": ["un drill concreto"],
  "note": "una frase honesta"
}
DATOS:
${JSON.stringify(stats).slice(0, 8000)}`,
      0.2,
      800,
      { timeoutMs: 20_000, models: ["gemini-flash-lite-latest", "gemini-flash-latest"] },
    );
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/u, "").trim();
    generated = JSON.parse(cleaned) as Partial<LiveGuide>;
  } catch (error) {
    console.error("live guide gemini", error);
  }

  return {
    updatedAt: new Date().toISOString(),
    callCount: calls.length,
    ready: true,
    offerName,
    note:
      generated.note ||
      `${closed.length} cierres en ${calls.length} llamadas. Patrones con evidencia; no hay más de lo que muestran los números.`,
    closingTypes:
      generated.closingTypes?.length
        ? generated.closingTypes
        : stats.byType.map((row) => ({
            type: row.type,
            approach: "",
            closed: row.closed,
            total: row.total,
          })),
    scriptVariations:
      generated.scriptVariations?.length
        ? generated.scriptVariations
        : stats.byPay.map((row) => ({
            leadType: "todos",
            variation: row.variation,
            closed: row.closed,
            total: row.total,
          })),
    winMoments: generated.winMoments || [],
    missingInLosses: generated.missingInLosses || stats.lostReasons.slice(0, 5).map(String),
    drills: generated.drills || [],
  };
}

export function liveGuideForPrompt(guide: LiveGuide | null | undefined) {
  if (!guide) return "";
  if (!guide.ready) return `LIVE GUIDE: ${guide.note}`;
  return `LIVE GUIDE (${guide.offerName}, ${guide.callCount} llamadas):
Cierra más: ${guide.closingTypes.map((row) => `${row.type} ${row.approach} ${row.closed}/${row.total}`).join("; ") || "—"}
Variaciones: ${guide.scriptVariations.map((row) => `${row.leadType}: ${row.variation} ${row.closed}/${row.total}`).join("; ") || "—"}
En cierres: ${guide.winMoments.join(" | ") || "—"}
No aparece en pérdidas: ${guide.missingInLosses.join(" | ") || "—"}`;
}
