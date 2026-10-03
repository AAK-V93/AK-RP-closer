import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { followupRepairIsCurrent, runFollowupRepairIfStale } from "./crm-apply";

const latest = new Date("2026-09-02T15:00:00.000Z");

test("a repair watermark covers calls that are not newer", () => {
  assert.equal(followupRepairIsCurrent(null, null), true);
  assert.equal(followupRepairIsCurrent(latest, null), false);
  assert.equal(followupRepairIsCurrent(latest, latest.toISOString()), true);
  assert.equal(
    followupRepairIsCurrent(latest, new Date(latest.getTime() - 1).toISOString()),
    false,
  );
});

test("a current watermark does not scan call filings", async () => {
  let probes = 0;
  const prisma = {
    $queryRaw: async () => {
      probes += 1;
      return [{ latest, watermark: latest.toISOString() }];
    },
    callRecord: {
      findFirst: async () => {
        throw new Error("filing scan");
      },
    },
  };
  await runFollowupRepairIfStale(prisma as never, "user-1");
  assert.equal(probes, 1);
});

test("the dashboard read does not run follow-up repair", () => {
  const metrics = readFileSync(new URL("./crm-metrics.ts", import.meta.url), "utf8");
  assert.equal(/await\s+repairGate/.test(metrics), false);
  assert.equal(/await\s+scheduleMissingFollowupRepair/.test(metrics), false);
  assert.equal(/await\s+runFollowupRepairIfStale/.test(metrics), false);
  assert.equal(/await\s+repairMissingFollowups/.test(metrics), false);
  assert.equal(metrics.includes('markTiming(opts?.timings, "repair"'), false);
  assert.equal(metrics.includes("scheduleMissingFollowupRepair"), true);
  const apply = readFileSync(new URL("./crm-apply.ts", import.meta.url), "utf8");
  const start = apply.indexOf("export function scheduleMissingFollowupRepair");
  assert.ok(start > 0);
  const next = apply.indexOf("\nexport ", start + 10);
  const body = apply.slice(start, next === -1 ? undefined : next);
  assert.equal(body.includes("$queryRaw"), false);
  assert.equal(body.includes("repairMissingFollowups"), false);
  assert.match(body, /after\(/);
  const crmPage = readFileSync(new URL("../app/crm/page.tsx", import.meta.url), "utf8");
  assert.equal(crmPage.includes("Cargando…"), false);
  assert.equal(crmPage.includes("CrmSkeleton"), true);
  const controls = readFileSync(
    new URL("../components/chat-controls.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(controls.includes("Cómo practicar") || controls.includes("HowToPracticeButton"), true);
});
