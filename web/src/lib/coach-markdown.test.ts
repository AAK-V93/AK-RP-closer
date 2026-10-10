import assert from "node:assert/strict";
import { test } from "node:test";
import { coachBlocks } from "./coach-markdown";

test("bold markers render as emphasis and stray asterisks disappear", () => {
  const blocks = coachBlocks("Escribe **exactamente** esto.\nY *no* dejes asteriscos.");
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], [
    { text: "Escribe ", bold: false },
    { text: "exactamente", bold: true },
    { text: " esto.", bold: false },
  ]);
  assert.equal(blocks[1]?.map((span) => span.text).join(""), "Y no dejes asteriscos.");
  assert.equal(JSON.stringify(blocks).includes("**"), false);
  assert.equal(JSON.stringify(blocks).includes("*"), false);
});
