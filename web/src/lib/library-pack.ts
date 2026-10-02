export type LibraryPackItem = {
  id: string;
  type: string;
  canal: string;
  recomendacion: string;
  guion: string;
  asset?: string;
  uses: number;
  puntaje: number;
  tasaCierre: number;
  tasaEnvio: number;
};

export type LibraryPack = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  publisher: string;
  mine: boolean;
  starred: boolean;
  stars: number;
  scripts: number;
  uses: number;
  puntaje: number;
  tasaCierre: number;
  tasaEnvio: number;
  items: LibraryPackItem[];
  builtin?: boolean;
};

export type LibraryOffer = { id: string; productName: string; scriptCount: number };

export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function asRecordList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: unknown[] }).items;
  }
  return [];
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asItem(value: unknown, index: number): LibraryPackItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id || "").trim();
  if (!id && !row.guion && !row.type) return null;
  return {
    id: id || `item-${index}`,
    type: String(row.type || ""),
    canal: String(row.canal || ""),
    recomendacion: String(row.recomendacion || ""),
    guion: String(row.guion || ""),
    asset: row.asset == null ? "" : String(row.asset),
    uses: num(row.uses),
    puntaje: num(row.puntaje),
    tasaCierre: num(row.tasaCierre),
    tasaEnvio: num(row.tasaEnvio),
  };
}

export function normalizeLibraryPack(value: unknown, index = 0): LibraryPack | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const items = asRecordList(row.items)
    .map((item, itemIndex) => asItem(item, itemIndex))
    .filter((item): item is LibraryPackItem => item !== null);
  const id = String(row.id || "").trim();
  const title = String(row.title || "").trim();
  if (!id && !title) return null;
  return {
    id: id || `pack-${index}`,
    title: title || "Sin nombre",
    description: String(row.description || ""),
    tags: asStringList(row.tags),
    publisher: String(row.publisher || ""),
    mine: Boolean(row.mine),
    starred: Boolean(row.starred),
    stars: num(row.stars),
    scripts: Number.isFinite(Number(row.scripts)) ? num(row.scripts) : items.length,
    uses: num(row.uses),
    puntaje: num(row.puntaje),
    tasaCierre: num(row.tasaCierre),
    tasaEnvio: num(row.tasaEnvio),
    items,
    builtin: Boolean(row.builtin),
  };
}

export function normalizeLibraryOffers(value: unknown): LibraryOffer[] {
  return asRecordList(value)
    .filter((offer) => offer && typeof offer === "object")
    .map((offer) => {
      const row = offer as Record<string, unknown>;
      return {
        id: String(row.id || "").trim(),
        productName: String(row.productName || "Oferta"),
        scriptCount: num(row.scriptCount),
      };
    })
    .filter((offer) => offer.id);
}

export function normalizeLibraryPayload(data: unknown): {
  packs: LibraryPack[];
  offers: LibraryOffer[];
} {
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const packs = asRecordList(row.packs ?? row.items)
    .map((pack, index) => normalizeLibraryPack(pack, index))
    .filter((pack): pack is LibraryPack => pack !== null);
  return { packs, offers: normalizeLibraryOffers(row.offers) };
}
