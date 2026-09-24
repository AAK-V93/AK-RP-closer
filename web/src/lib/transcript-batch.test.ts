import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTranscriptFilename,
  partitionTranscriptUploads,
  transcriptTitle,
  UPLOAD_CHUNK_FILES,
} from "./transcript-batch";

test("a folder keeps transcripts and drops video", () => {
  const files = [
    { name: "llamadas/zoom-a.vtt", size: 1000 },
    { name: "llamadas/zoom-b.mp4", size: 1000 },
    { name: "llamadas/notas.pdf", size: 1000 },
  ];
  const split = partitionTranscriptUploads(files);
  assert.equal(split.accepted.length, 2);
  assert.equal(split.ignored, 1);
  assert.equal(split.chunks.length, 1);
  assert.equal(isTranscriptFilename("audio.m4a"), false);
  assert.equal(transcriptTitle("carpeta/Sol Valverde.vtt"), "Sol Valverde");
});

test("more than twenty transcripts stay in one upload, split only by size", () => {
  const files = Array.from({ length: 30 }, (_, index) => ({
    name: `call-${index}.txt`,
    size: 1000,
  }));
  const split = partitionTranscriptUploads(files);
  assert.equal(split.accepted.length, 30);
  assert.equal(split.chunks.length, 2);
  assert.equal(split.chunks[0].length, UPLOAD_CHUNK_FILES);
  assert.equal(split.chunks[1].length, 5);
});
