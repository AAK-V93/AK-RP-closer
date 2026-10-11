// From a source's raw content to case items. Each item keeps the exact text
// it was read from (sourceSnippet) so figures can be checked against it.
import { createHash } from "node:crypto";
import { normalizeName } from "@/lib/text/name-norm";
import { youtubeVideoId } from "./links";

export type CaseFields = {
  name: string | null;
  profile: string | null;
  before: string | null;
  result: string | null;
  quote: string | null;
  mediaUrl: string | null;
};

export type CaseItem = {
  externalKey: string;
  snippet: string;
  /** what could be read without a model (sheet columns, video title) */
  hints: CaseFields;
};

export const SNIPPET_MAX = 800;
export const SHEET_ROWS_MAX = 200;

export const EMPTY_FIELDS: CaseFields = { name: null, profile: null, before: null, result: null, quote: null, mediaUrl: null };

const HEADERS: Record<keyof CaseFields, RegExp> = {
  name: /^(nombre|name|cliente|alumn[oa]|estudiante|persona|caso)\b/,
  profile: /^(perfil|profesion|profesión|quien es|quién es|ocupacion|ocupación|nicho|sobre)\b/,
  before: /^(antes|situacion inicial|situación inicial|punto de partida|problema|dolor)\b/,
  result: /^(resultado|resultados|despues|después|logro|logros|transformacion|transformación)\b/,
  quote: /^(frase|cita|testimonio|comentario|quote)\b/,
  mediaUrl: /^(video|vídeo|link|enlace|url|youtube|testimonio en video)\b/,
};

function clip(text: string, max = SNIPPET_MAX) {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/** Which column holds which field, by header text. -1 = none. */
export function mapHeaders(headers: string[]): Record<keyof CaseFields, number> {
  const norm = headers.map((h) => normalizeName(h));
  const out = {} as Record<keyof CaseFields, number>;
  const used = new Set<number>();
  for (const field of Object.keys(HEADERS) as (keyof CaseFields)[]) {
    const i = norm.findIndex((h, idx) => !used.has(idx) && HEADERS[field].test(h));
    out[field] = i;
    if (i >= 0) used.add(i);
  }
  return out;
}

/**
 * Stable key for a case so a re-sync finds it again, and the same video in
 * a sheet and a playlist is one case: yt:<videoId>, else url:<link>, else
 * row:<hash of normalized name + link>.
 */
export function caseKey(name: string | null, link: string | null) {
  const video = link ? youtubeVideoId(link) : null;
  if (video) return `yt:${video}`;
  const url = link?.trim();
  if (url && /^https?:\/\//i.test(url)) return `url:${url.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase()}`;
  const base = `${normalizeName(name ?? "")}|${url ?? ""}`;
  return `row:${createHash("sha256").update(base).digest("hex").slice(0, 24)}`;
}

/** Rows of a sheet (first row = headers). Snippet = «Columna: valor» lines of that row. */
export function sheetItems(rows: string[][]): CaseItem[] {
  if (rows.length < 2) return [];
  const [headers, ...body] = rows;
  const map = mapHeaders(headers);
  const items: CaseItem[] = [];
  const seen = new Set<string>();
  for (const row of body.slice(0, SHEET_ROWS_MAX)) {
    const snippet = clip(
      headers
        .map((h, i) => (row[i]?.trim() ? `${h.trim() || `Columna ${i + 1}`}: ${row[i].trim()}` : null))
        .filter(Boolean)
        .join("\n"),
    );
    if (!snippet) continue;
    const get = (f: keyof CaseFields) => (map[f] >= 0 ? clean(row[map[f]]) : null);
    const mediaUrl = get("mediaUrl") ?? row.map((c) => c.trim()).find((c) => /^https?:\/\//i.test(c)) ?? null;
    const hints: CaseFields = {
      name: get("name"),
      profile: get("profile"),
      before: get("before"),
      result: get("result"),
      quote: get("quote"),
      mediaUrl,
    };
    const externalKey = caseKey(hints.name ?? snippet, mediaUrl);
    if (seen.has(externalKey)) continue;
    seen.add(externalKey);
    items.push({ externalKey, snippet, hints });
  }
  return items;
}

export type VideoInfo = { videoId: string; title: string; description: string };

/** YouTube: only title + description (never captions). */
export function videoItems(videos: VideoInfo[]): CaseItem[] {
  const seen = new Set<string>();
  return videos
    .filter((v) => !seen.has(v.videoId) && seen.add(v.videoId))
    .map((v) => ({
      externalKey: `yt:${v.videoId}`,
      snippet: clip(`${v.title}\n${v.description}`),
      hints: { ...EMPTY_FIELDS, mediaUrl: `https://www.youtube.com/watch?v=${v.videoId}` },
    }));
}

/** A sheet row whose columns already say who and what changed needs no model. */
export function readableWithoutModel(item: CaseItem) {
  return Boolean(item.hints.name && (item.hints.result || item.hints.before));
}

export function contentHash(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
