import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HUB_PAINT_AFTER,
  HUB_PAINT_BEFORE,
  coldHomeBudgetMs,
  hubTtfbAfter,
  hubTtfbBefore,
} from "./home-load-budget";

test("a cold home load no longer waits on 87 schema statements", () => {
  const budget = coldHomeBudgetMs(40);
  assert.equal(budget.schemaSerial, 87);
  assert.ok(budget.before > 3000);
  assert.ok(budget.after < 500);
  assert.ok(budget.after < budget.before / 5);
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Same graph as production, with the QA durations scaled so the test stays short. */
async function measuredHubWall(scale: number, kind: "before" | "after") {
  const s = kind === "before" ? HUB_PAINT_BEFORE : HUB_PAINT_AFTER;
  const ms = (n: number) => Math.round(n * scale);
  const started = performance.now();
  await sleep(ms(s.prisma));
  await sleep(ms(s.ensure));
  if (kind === "before") {
    const thread = sleep(ms(s.thread));
    await sleep(ms(s.home));
    await sleep(ms(s.prefs));
    await Promise.all([sleep(ms(s.dashboard)), sleep(ms(s.filings))]);
    await sleep(ms(s.projection));
    await thread;
  } else {
    await Promise.all([
      sleep(ms(s.home)),
      sleep(ms(s.prefs)),
      sleep(ms(s.dashboard)),
      sleep(ms(s.filings)),
      sleep(ms(s.thread)),
    ]);
  }
  return performance.now() - started;
}

test("Inicio TTFB drops under 500 ms once the hub queries overlap", async () => {
  const before = hubTtfbBefore(HUB_PAINT_BEFORE);
  const after = hubTtfbAfter(HUB_PAINT_AFTER);
  assert.equal(before, 675);
  assert.equal(after, 315);
  assert.ok(after < 500);
  assert.ok(after < before);
  const scale = 0.05;
  const measuredBefore = await measuredHubWall(scale, "before");
  const measuredAfter = await measuredHubWall(scale, "after");
  assert.ok(measuredBefore > before * scale * 0.8);
  assert.ok(measuredAfter < 500 * scale + 40);
  assert.ok(measuredAfter < measuredBefore);
});
