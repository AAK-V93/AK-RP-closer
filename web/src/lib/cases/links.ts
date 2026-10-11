// Success-case links (revision-arquitecto-casos-exito.md): what kind of
// source a pasted link is. Pure; no network.
export type CaseSourceKind = "SHEET" | "YOUTUBE_PLAYLIST" | "YOUTUBE_CHANNEL" | "YOUTUBE_VIDEO";

export type ParsedLink =
  | { ok: true; kind: CaseSourceKind; externalId: string; rawUrl: string; sheetId?: string; gid?: string }
  | { ok: false; rawUrl: string; reason: string };

const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const VIDEO_ID = /^[\w-]{11}$/;

/** Video id of a YouTube watch / short / youtu.be link, or null. */
export function youtubeVideoId(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return VIDEO_ID.test(id) ? id : null;
  }
  if (!YT_HOSTS.has(host)) return null;
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }
  const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
  return m ? m[1] : null;
}

export function parseCaseLink(input: string): ParsedLink {
  const rawUrl = input.trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, rawUrl, reason: "No parece un enlace" };
  }
  const host = url.hostname.toLowerCase();

  if (host === "docs.google.com") {
    const m = url.pathname.match(/^\/spreadsheets\/d\/([\w-]{20,})/);
    if (!m) return { ok: false, rawUrl, reason: "Ese enlace de Google no es una hoja de cálculo" };
    const gid = url.hash.match(/gid=(\d+)/)?.[1] ?? url.searchParams.get("gid") ?? undefined;
    return { ok: true, kind: "SHEET", externalId: gid ? `${m[1]}#${gid}` : m[1], rawUrl, sheetId: m[1], gid };
  }

  if (YT_HOSTS.has(host) || host === "youtu.be") {
    const list = url.searchParams.get("list");
    if (url.pathname === "/playlist" && list) return { ok: true, kind: "YOUTUBE_PLAYLIST", externalId: list, rawUrl };
    const video = youtubeVideoId(rawUrl);
    if (video) return { ok: true, kind: "YOUTUBE_VIDEO", externalId: video, rawUrl };
    const channel = url.pathname.match(/^\/channel\/(UC[\w-]{22})/);
    if (channel) return { ok: true, kind: "YOUTUBE_CHANNEL", externalId: channel[1], rawUrl };
    const handle = url.pathname.match(/^\/(@[\w.-]{3,})/);
    if (handle) return { ok: true, kind: "YOUTUBE_CHANNEL", externalId: handle[1], rawUrl };
    return { ok: false, rawUrl, reason: "Ese enlace de YouTube no es un video, una lista ni un canal" };
  }

  return { ok: false, rawUrl, reason: "Por ahora leo hojas de Google y enlaces de YouTube" };
}

/** Several links pasted together (one per line, or separated by spaces). Same source once. */
export function parseCaseLinks(text: string): ParsedLink[] {
  const seen = new Set<string>();
  const out: ParsedLink[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const parsed = parseCaseLink(token);
    const key = parsed.ok ? `${parsed.kind}:${parsed.externalId}` : `bad:${parsed.rawUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
}

/** CSV export of a link-shared sheet (no OAuth). */
export function sheetCsvUrl(sheetId: string, gid?: string) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}
