import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { parseCommercial } from "@/lib/offer-commercial";
import {
  fillFollowupGuion,
  listFollowupScripts,
  parseFollowupScripts,
  type FollowupScript,
  type FollowupVars,
} from "@/lib/followup-scripts";

export function packScore(row: {
  uses: number;
  hechos: number;
  cierres: number;
  perdidos: number;
}) {
  const decided = row.cierres + row.perdidos;
  const sirvio = decided ? row.cierres / decided : 0;
  const envio = row.uses ? row.hechos / row.uses : 0;
  return {
    uses: row.uses,
    tasaEnvio: envio,
    tasaCierre: sirvio,
    puntaje: Math.round((sirvio * 0.7 + envio * 0.3) * 100),
  };
}

export async function listPublicPacks(prisma: PrismaClient, userId: string) {
  const packs = await prisma.followupPack.findMany({
    where: { visibility: "public" },
    include: {
      user: { select: { name: true, email: true } },
      scripts: true,
      stars: { where: { userId } },
      _count: { select: { stars: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  return packs.map((pack) => {
    const agg = pack.scripts.reduce(
      (sum, row) => ({
        uses: sum.uses + row.uses,
        hechos: sum.hechos + row.hechos,
        cierres: sum.cierres + row.cierres,
        perdidos: sum.perdidos + row.perdidos,
      }),
      { uses: 0, hechos: 0, cierres: 0, perdidos: 0 },
    );
    return {
      id: pack.id,
      title: pack.title,
      description: pack.description,
      tags: pack.tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      publisher: pack.user.name || pack.user.email.split("@")[0],
      publisherId: pack.userId,
      mine: pack.userId === userId,
      starred: pack.stars.length > 0,
      stars: pack._count.stars,
      scripts: pack.scripts.length,
      updatedAt: pack.updatedAt.toISOString(),
      ...packScore(agg),
      items: pack.scripts.map((row) => ({
        id: row.id,
        type: row.type,
        canal: row.canal,
        recomendacion: row.recomendacion,
        guion: row.guion,
        asset: row.asset,
        ...packScore(row),
      })),
    };
  });
}

async function linkOriginIdsToOffer(
  prisma: PrismaClient,
  offer: { id: string; commercial: unknown },
  created: { id: string; key: string }[],
) {
  if (!created.length) return;
  const commercial = parseCommercial(offer.commercial);
  const byKey = new Map(created.map((row) => [row.key, row.id]));
  commercial.scripts = commercial.scripts.map((row) => ({
    ...row,
    originId: byKey.get(row.key) || row.originId,
  }));
  await prisma.userOffer.update({
    where: { id: offer.id },
    data: { commercial: commercial as unknown as Prisma.InputJsonValue },
  });
}

export async function publishPack(
  prisma: PrismaClient,
  userId: string,
  args: { offerId: string; title: string; description?: string; tags?: string },
) {
  const offer = await prisma.userOffer.findFirst({
    where: { id: args.offerId, userId },
  });
  if (!offer) return { error: "Oferta no encontrada" as const };
  const scripts = parseCommercial(offer.commercial).scripts;
  if (!scripts.length) {
    return { error: "Esta oferta no tiene scripts propios para publicar" as const };
  }
  const pack = await prisma.followupPack.create({
    data: {
      userId,
      title: args.title.trim() || `Seguimientos · ${offer.productName}`,
      description: args.description?.trim() || "",
      tags: args.tags?.trim() || "",
      scripts: {
        create: scripts.map((row) => ({
          key: row.key,
          type: row.type,
          intentosMin: row.intentosMin,
          canal: row.canal,
          recomendacion: row.recomendacion,
          guion: row.guion,
          asset: row.asset || "",
        })),
      },
    },
    include: { scripts: true },
  });
  await linkOriginIdsToOffer(prisma, offer, pack.scripts);
  return { ok: true as const, packId: pack.id };
}

export async function publishCustomPack(
  prisma: PrismaClient,
  userId: string,
  args: {
    title: string;
    description?: string;
    tags?: string;
    scripts: unknown;
  },
) {
  const scripts = parseFollowupScripts(args.scripts);
  if (!scripts.length) {
    return { error: "Pega al menos un guion con tipo y texto" as const };
  }
  const title = args.title.trim();
  if (title.length < 3) {
    return { error: "Ponle un nombre al pack" as const };
  }
  const pack = await prisma.followupPack.create({
    data: {
      userId,
      title,
      description: args.description?.trim() || "",
      tags: args.tags?.trim() || "",
      scripts: {
        create: scripts.map((row) => ({
          key: row.key,
          type: row.type,
          intentosMin: row.intentosMin,
          canal: row.canal,
          recomendacion: row.recomendacion,
          guion: row.guion,
          asset: row.asset || "",
        })),
      },
    },
  });
  return { ok: true as const, packId: pack.id };
}

export async function toggleStar(prisma: PrismaClient, userId: string, packId: string) {
  const pack = await prisma.followupPack.findFirst({
    where: { id: packId, visibility: "public" },
  });
  if (!pack) return { error: "Pack no encontrado" as const };
  const existing = await prisma.followupStar.findUnique({
    where: { userId_packId: { userId, packId } },
  });
  if (existing) {
    await prisma.followupStar.delete({ where: { id: existing.id } });
    return { starred: false };
  }
  await prisma.followupStar.create({ data: { userId, packId } });
  return { starred: true };
}

export async function installPack(
  prisma: PrismaClient,
  userId: string,
  args: { packId: string; offerId: string },
) {
  const pack = await prisma.followupPack.findFirst({
    where: { id: args.packId, visibility: "public" },
    include: { scripts: true },
  });
  if (!pack) return { error: "Pack no encontrado" as const };
  const offer = await prisma.userOffer.findFirst({
    where: { id: args.offerId, userId },
  });
  if (!offer) return { error: "Oferta no encontrada" as const };
  const commercial = parseCommercial(offer.commercial);
  const incoming: FollowupScript[] = pack.scripts.map((row) => ({
    key: row.key || `${row.type}-${row.id.slice(0, 6)}`,
    type: row.type,
    intentosMin: row.intentosMin,
    canal: (row.canal as FollowupScript["canal"]) || "WHATSAPP",
    recomendacion: row.recomendacion,
    guion: row.guion,
    asset: row.asset || undefined,
    originId: row.id,
  }));
  const byKey = new Map(commercial.scripts.map((row) => [row.key, row]));
  for (const row of incoming) byKey.set(row.key, row);
  commercial.scripts = [...byKey.values()];
  await prisma.userOffer.update({
    where: { id: offer.id },
    data: { commercial: commercial as unknown as Prisma.InputJsonValue },
  });
  return { ok: true as const, added: incoming.length };
}

export async function recordLibraryOutcome(
  prisma: PrismaClient,
  scriptId: string,
  resultado: string,
) {
  if (!scriptId) return;
  if (!["hecho", "no_contesto", "cerro", "perdido"].includes(resultado)) return;
  const data: Prisma.FollowupLibraryScriptUpdateInput = {
    uses: { increment: 1 },
  };
  if (resultado === "hecho" || resultado === "no_contesto") {
    data.hechos = { increment: 1 };
  }
  if (resultado === "cerro") {
    data.hechos = { increment: 1 };
    data.cierres = { increment: 1 };
  }
  if (resultado === "perdido") data.perdidos = { increment: 1 };
  try {
    await prisma.followupLibraryScript.update({
      where: { id: scriptId },
      data,
    });
  } catch {
    /* pack borrado o id viejo */
  }
}

export type FollowupOption = {
  id: string;
  source: "oferta" | "biblioteca" | "base";
  publisher: string;
  type: string;
  canal: string;
  recomendacion: string;
  mensaje: string;
  originId: string;
  puntaje: number | null;
  uses: number;
};

const SKIP_OPTIONS = new Set(["AGENDA_CHECK", "COMISION"]);

type LibraryRow = {
  id: string;
  key: string;
  type: string;
  intentosMin: number;
  canal: string;
  recomendacion: string;
  guion: string;
  asset: string;
  uses: number;
  hechos: number;
  cierres: number;
  perdidos: number;
  pack: { user: { name: string | null; email: string } };
};

function optionId(script: FollowupScript, source: FollowupOption["source"]) {
  if (script.originId) return script.originId;
  return `${source}:${script.key}`;
}

function filledMensaje(script: FollowupScript, vars: FollowupVars) {
  const text = fillFollowupGuion(script.guion, vars);
  return script.asset ? `${text}\n${script.asset}` : text;
}

function sameGuion(a: string, b: string) {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}

export async function followupOptionsFor(
  prisma: PrismaClient,
  args: {
    type: string;
    intentos: number;
    vars: FollowupVars;
    offerScripts: FollowupScript[];
    selectedId?: string;
    libraryRows?: LibraryRow[];
  },
): Promise<FollowupOption[]> {
  if (SKIP_OPTIONS.has(args.type)) return [];
  const own = listFollowupScripts(args.type, args.intentos, args.offerScripts).filter(
    (row) => args.offerScripts.some((item) => item.key === row.key && item.guion === row.guion),
  );
  const base = listFollowupScripts(args.type, args.intentos, []).slice(0, 1);
  const library =
    args.libraryRows ||
    (await prisma.followupLibraryScript.findMany({
      where: {
        type: args.type === "OTRO" ? { in: ["OTRO", "RETOMAR"] } : args.type,
        intentosMin: { lte: args.intentos },
        pack: { visibility: "public" },
      },
      include: {
        pack: { include: { user: { select: { name: true, email: true } } } },
      },
      take: 40,
    }));
  const matchingLib = library.filter(
    (row) =>
      row.intentosMin <= args.intentos &&
      (row.type === args.type || (args.type === "OTRO" && row.type === "RETOMAR")),
  );
  const options: FollowupOption[] = [];
  const push = (row: FollowupOption) => {
    if (options.some((item) => sameGuion(item.mensaje, row.mensaje))) return;
    options.push(row);
  };
  for (const script of own) {
    push({
      id: optionId(script, "oferta"),
      source: "oferta",
      publisher: "tu oferta",
      type: script.type,
      canal: script.canal,
      recomendacion: script.recomendacion,
      mensaje: filledMensaje(script, args.vars),
      originId: script.originId || "",
      puntaje: null,
      uses: 0,
    });
  }
  const rankedLib = matchingLib
    .map((row) => ({ row, score: packScore(row) }))
    .sort((a, b) => b.score.puntaje - a.score.puntaje || b.score.uses - a.score.uses);
  for (const { row, score } of rankedLib) {
    const script: FollowupScript = {
      key: row.key,
      type: row.type,
      intentosMin: row.intentosMin,
      canal: (row.canal as FollowupScript["canal"]) || "WHATSAPP",
      recomendacion: row.recomendacion,
      guion: row.guion,
      asset: row.asset || undefined,
      originId: row.id,
    };
    push({
      id: row.id,
      source: "biblioteca",
      publisher: row.pack.user.name || row.pack.user.email.split("@")[0],
      type: row.type,
      canal: script.canal,
      recomendacion: row.recomendacion,
      mensaje: filledMensaje(script, args.vars),
      originId: row.id,
      puntaje: score.puntaje,
      uses: row.uses,
    });
    if (options.filter((item) => item.source === "biblioteca").length >= 3) break;
  }
  for (const script of base) {
    push({
      id: optionId(script, "base"),
      source: "base",
      publisher: "secuencia base",
      type: script.type,
      canal: script.canal,
      recomendacion: script.recomendacion,
      mensaje: filledMensaje(script, args.vars),
      originId: "",
      puntaje: null,
      uses: 0,
    });
  }
  const sliced = options.slice(0, 4);
  if (args.selectedId && !sliced.some((row) => row.id === args.selectedId || row.originId === args.selectedId)) {
    const selected = options.find(
      (row) => row.id === args.selectedId || row.originId === args.selectedId,
    );
    if (selected) sliced[sliced.length - 1] = selected;
  }
  return sliced;
}

export async function chooseFollowupOption(
  prisma: PrismaClient,
  userId: string,
  alertId: string,
  optionIdValue: string,
) {
  const row = await prisma.leadAlert.findFirst({
    where: { id: alertId, userId, resolvedAt: null },
    include: { lead: true },
  });
  if (!row) return { error: "Alerta no encontrada" as const };
  const offer = row.lead.offerName
    ? await prisma.userOffer.findFirst({
        where: { userId, productName: row.lead.offerName },
      })
    : await prisma.userOffer.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" } });
  const commercial = parseCommercial(offer?.commercial);
  const vars: FollowupVars = {
    nombre: row.lead.name,
    programa: row.lead.offerName || offer?.productName || "",
    monto: row.enJuego ? String(Math.round(row.enJuego)) : "",
    saldo: row.enJuego ? String(Math.round(row.enJuego)) : "",
    fecha: row.dueAt.toISOString().slice(0, 10),
    pago: commercial.paymentDetails,
    objecion: row.lead.razonNoCierre || row.lead.objections || "",
    deseo: "",
    closer: "",
  };
  const options = await followupOptionsFor(prisma, {
    type: row.type,
    intentos: row.intentos,
    vars,
    offerScripts: commercial.scripts,
    selectedId: optionIdValue,
  });
  const picked = options.find((item) => item.id === optionIdValue || item.originId === optionIdValue);
  if (!picked) return { error: "Esa opción ya no está" as const };
  const canal = picked.canal === "LLAMADA" ? "LLAMADA" : "WHATSAPP";
  await prisma.leadAlert.update({
    where: { id: row.id },
    data: {
      mensajeSugerido: picked.mensaje,
      canal,
      contexto: [picked.recomendacion, row.contexto.split("\n").slice(1).join("\n")]
        .filter(Boolean)
        .join("\n"),
      libraryScriptId: picked.originId,
    },
  });
  return { ok: true as const, option: picked };
}

export async function attachFollowupOptions<
  T extends {
    id: string;
    tipo: string;
    intentos?: number;
    libraryScriptId?: string;
    cliente: string;
    oferta: string;
    enJuego: number;
    dueAt: string;
    contexto: string;
    mensajeSugerido: string;
    objecion?: string;
  },
>(
  prisma: PrismaClient,
  userId: string,
  rows: T[],
): Promise<(T & { opciones: FollowupOption[]; selectedId: string })[]> {
  if (!rows.length) return [];
  const offers = await prisma.userOffer.findMany({ where: { userId } });
  const types = [
    ...new Set(rows.map((row) => row.tipo).filter((tipo) => !SKIP_OPTIONS.has(tipo))),
  ];
  const libraryRows: LibraryRow[] = types.length
    ? await prisma.followupLibraryScript.findMany({
        where: { type: { in: types }, pack: { visibility: "public" } },
        include: {
          pack: { include: { user: { select: { name: true, email: true } } } },
        },
        take: 80,
      })
    : [];
  const byName = new Map(offers.map((row) => [row.productName, row]));
  const fallback = offers[0];
  return Promise.all(
    rows.map(async (row) => {
      const offer = byName.get(row.oferta) || fallback;
      const commercial = parseCommercial(offer?.commercial);
      const vars: FollowupVars = {
        nombre: row.cliente,
        programa: row.oferta || offer?.productName || "",
        monto: row.enJuego ? String(Math.round(row.enJuego)) : "",
        saldo: row.enJuego ? String(Math.round(row.enJuego)) : "",
        fecha: row.dueAt.slice(0, 10),
        pago: commercial.paymentDetails,
        objecion: row.objecion || "",
        deseo: "",
        closer: "",
      };
      const opciones = await followupOptionsFor(prisma, {
        type: row.tipo,
        intentos: row.intentos || 0,
        vars,
        offerScripts: commercial.scripts,
        selectedId: row.libraryScriptId,
        libraryRows,
      });
      const selectedId =
        opciones.find((item) => item.originId && item.originId === row.libraryScriptId)?.id ||
        opciones.find((item) => item.id === row.libraryScriptId)?.id ||
        opciones.find((item) => item.mensaje === row.mensajeSugerido)?.id ||
        opciones[0]?.id ||
        "";
      return { ...row, opciones, selectedId };
    }),
  );
}
