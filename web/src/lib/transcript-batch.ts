export const TRANSCRIPT_EXTENSIONS = [".txt", ".md", ".vtt", ".srt", ".csv", ".pdf"];
export const MAX_TRANSCRIPT_BYTES = 6 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 3_500_000;
export const UPLOAD_CHUNK_FILES = 25;

export function transcriptBaseName(name: string) {
  return (name.split(/[/\\]/).pop() || name).trim();
}

export function isTranscriptFilename(name: string) {
  const base = transcriptBaseName(name).toLowerCase();
  return TRANSCRIPT_EXTENSIONS.some((ext) => base.endsWith(ext));
}

export function transcriptTitle(name: string) {
  const base = transcriptBaseName(name).replace(/\.[^.]+$/, "");
  return base.slice(0, 120) || "Transcripción";
}

export function partitionTranscriptUploads<T extends { name: string; size: number }>(files: T[]) {
  const accepted: T[] = [];
  let ignored = 0;
  let tooBig = 0;
  for (const file of files) {
    if (!isTranscriptFilename(file.name)) {
      ignored += 1;
      continue;
    }
    if (file.size > MAX_TRANSCRIPT_BYTES) {
      tooBig += 1;
      continue;
    }
    accepted.push(file);
  }
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const file of accepted) {
    const full =
      current.length >= UPLOAD_CHUNK_FILES ||
      (current.length > 0 && bytes + file.size > UPLOAD_CHUNK_BYTES);
    if (full) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  if (current.length > 0) chunks.push(current);
  return { accepted, ignored, tooBig, chunks };
}
