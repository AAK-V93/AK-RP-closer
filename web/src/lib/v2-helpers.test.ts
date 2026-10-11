import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "@/lib/rate-limit";
import { ONE_LINE_MAX, toOneLine } from "@/lib/write/one-line";

test("rate limiter: per user, resets after the window", () => {
  const take = createRateLimiter(2, 1000);
  assert.equal(take("a", 0).ok, true);
  assert.equal(take("a", 10).ok, true);
  const third = take("a", 20);
  assert.equal(third.ok, false);
  assert.equal(third.retryAfterSec, 1);
  assert.equal(take("b", 20).ok, true); // other user unaffected
  assert.equal(take("a", 1000).ok, true);
});

test("oneLine: trimmed to 140 on write, empty is null", () => {
  assert.equal(toOneLine("   "), null);
  assert.equal(toOneLine(null), null);
  assert.equal(toOneLine("  Quedó   en pensarlo  "), "Quedó en pensarlo");
  const long = "Quiere entrar en noviembre ".repeat(10);
  const out = toOneLine(long)!;
  assert.ok(out.length <= ONE_LINE_MAX, String(out.length));
  assert.ok(out.endsWith("…"));
  assert.doesNotMatch(out, /\s…$/);
});
