// Network side of a case source. Sheets: CSV export of a link-shared sheet,
// or the file picked in Drive (drive.file token). YouTube: Data API v3 with a
// server key, title + description only (no search.list, no captions).
import { parseCsv } from "./csv";
import { type CaseItem, type VideoInfo, contentHash, sheetItems, videoItems } from "./items";
import { type CaseSourceKind, sheetCsvUrl } from "./links";

export type SourceRef = {
  kind: CaseSourceKind;
  access: "PUBLIC_LINK" | "DRIVE_PICKER";
  externalId: string;
  contentHash: string | null;
};

export type Loaded =
  | { status: "OK"; hash: string; items: CaseItem[]; titles: Map<string, string>; title: string | null }
  | { status: "UNCHANGED"; hash: string }
  | { status: "NEEDS_ACCESS"; message: string }
  | { status: "ERROR"; message: string };

export type LoadDeps = {
  fetch?: typeof fetch;
  /** Drive access token for DRIVE_PICKER sources; null when Drive is not connected */
  driveToken?: () => Promise<string | null>;
  youtubeKey?: string | null;
};

const CSV_MAX = 2_000_000;
const YT_PAGES = 2;

export const MSG = {
  sheetNoAccess:
    "No puedo abrir esa hoja. Compártela como «Cualquier persona con el enlace» o elígela desde tu Drive.",
  driveNotConnected: "Conecta tu Drive para leer esa hoja.",
  youtubeOff: "La lectura de YouTube todavía no está activada en esta cuenta.",
  youtubeEmpty: "No encontré videos públicos en ese enlace.",
  failed: "No pude leer ese enlace. Inténtalo de nuevo en un rato.",
};

async function timed(f: typeof fetch, url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await f(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

function splitSheetId(externalId: string) {
  const [sheetId, gid] = externalId.split("#");
  return { sheetId, gid };
}

async function loadSheet(ref: SourceRef, deps: Required<Pick<LoadDeps, "fetch">> & LoadDeps): Promise<Loaded> {
  const { sheetId, gid } = splitSheetId(ref.externalId);
  const headers: Record<string, string> = {};
  let title: string | null = null;
  let driveHash: string | null = null;
  if (ref.access === "DRIVE_PICKER") {
    const token = deps.driveToken ? await deps.driveToken() : null;
    if (!token) return { status: "NEEDS_ACCESS", message: MSG.driveNotConnected };
    headers.Authorization = `Bearer ${token}`;
    const meta = await timed(
      deps.fetch,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sheetId)}?fields=name,modifiedTime,version`,
      { headers },
    );
    if (meta.status === 401 || meta.status === 403 || meta.status === 404) return { status: "NEEDS_ACCESS", message: MSG.sheetNoAccess };
    if (!meta.ok) return { status: "ERROR", message: MSG.failed };
    const m = (await meta.json()) as { name?: string; modifiedTime?: string; version?: string };
    title = m.name ?? null;
    driveHash = contentHash(`${m.modifiedTime ?? ""}|${m.version ?? ""}|${gid ?? ""}`);
    if (ref.contentHash && driveHash === ref.contentHash) return { status: "UNCHANGED", hash: driveHash };
  }
  const res = await timed(deps.fetch, sheetCsvUrl(sheetId, gid), { headers, redirect: "follow" });
  const type = res.headers.get("content-type") ?? "";
  if (res.status === 401 || res.status === 403 || res.status === 404 || (res.ok && /text\/html/i.test(type))) {
    return { status: "NEEDS_ACCESS", message: MSG.sheetNoAccess };
  }
  if (!res.ok) return { status: "ERROR", message: MSG.failed };
  const text = (await res.text()).slice(0, CSV_MAX);
  const hash = driveHash ?? contentHash(text);
  if (ref.contentHash && hash === ref.contentHash) return { status: "UNCHANGED", hash };
  return { status: "OK", hash, items: sheetItems(parseCsv(text)), titles: new Map(), title };
}

type YtList<T> = { items?: T[]; nextPageToken?: string };
type YtSnippet = { title?: string; description?: string; resourceId?: { videoId?: string } };

async function ytGet<T>(f: typeof fetch, key: string, endpoint: string, params: Record<string, string>) {
  const q = new URLSearchParams({ ...params, key });
  const res = await timed(f, `https://www.googleapis.com/youtube/v3/${endpoint}?${q}`);
  if (!res.ok) throw new Error(`youtube ${endpoint} ${res.status}`);
  return (await res.json()) as YtList<T>;
}

const unavailable = (title: string) => /^(private video|deleted video|video privado|video eliminado)$/i.test(title.trim());

async function playlistVideos(f: typeof fetch, key: string, playlistId: string) {
  const out: VideoInfo[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < YT_PAGES; page += 1) {
    const data = await ytGet<{ snippet?: YtSnippet }>(f, key, "playlistItems", {
      part: "snippet",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const it of data.items ?? []) {
      const id = it.snippet?.resourceId?.videoId;
      const title = it.snippet?.title ?? "";
      if (id && !unavailable(title)) out.push({ videoId: id, title, description: it.snippet?.description ?? "" });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

async function loadYoutube(ref: SourceRef, deps: Required<Pick<LoadDeps, "fetch">> & LoadDeps): Promise<Loaded> {
  const key = deps.youtubeKey ?? null;
  if (!key) return { status: "ERROR", message: MSG.youtubeOff };
  let videos: VideoInfo[] = [];
  let title: string | null = null;
  try {
    if (ref.kind === "YOUTUBE_VIDEO") {
      const data = await ytGet<{ id: string; snippet?: YtSnippet }>(deps.fetch, key, "videos", { part: "snippet", id: ref.externalId });
      videos = (data.items ?? []).map((v) => ({ videoId: v.id, title: v.snippet?.title ?? "", description: v.snippet?.description ?? "" }));
      title = videos[0]?.title ?? null;
    } else {
      let playlistId = ref.externalId;
      if (ref.kind === "YOUTUBE_CHANNEL") {
        const by: Record<string, string> = ref.externalId.startsWith("@") ? { forHandle: ref.externalId } : { id: ref.externalId };
        const ch = await ytGet<{ snippet?: { title?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }>(
          deps.fetch, key, "channels", { part: "snippet,contentDetails", ...by },
        );
        const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        title = ch.items?.[0]?.snippet?.title ?? null;
        if (!uploads) return { status: "ERROR", message: MSG.youtubeEmpty };
        playlistId = uploads;
      }
      videos = await playlistVideos(deps.fetch, key, playlistId);
    }
  } catch {
    return { status: "ERROR", message: MSG.failed };
  }
  if (!videos.length) return { status: "ERROR", message: MSG.youtubeEmpty };
  const hash = contentHash(JSON.stringify(videos));
  if (ref.contentHash && hash === ref.contentHash) return { status: "UNCHANGED", hash };
  const items = videoItems(videos);
  const titles = new Map(videos.map((v) => [`yt:${v.videoId}`, v.title.trim()]));
  return { status: "OK", hash, items, titles, title };
}

export async function loadSource(ref: SourceRef, deps: LoadDeps = {}): Promise<Loaded> {
  const all = { ...deps, fetch: deps.fetch ?? fetch };
  try {
    return ref.kind === "SHEET" ? await loadSheet(ref, all) : await loadYoutube(ref, all);
  } catch {
    return { status: "ERROR", message: MSG.failed };
  }
}
