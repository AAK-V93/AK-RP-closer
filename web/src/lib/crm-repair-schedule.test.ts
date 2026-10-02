import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { followupRepairIsCurrent, scheduleMissingFollowupRepair } from "./crm-apply";

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
  await scheduleMissingFollowupRepair(prisma as never, "user-1");
  assert.equal(probes, 1);
});

test("the dashboard read does not wait for follow-up repair", () => {
  const metrics = readFileSync(new URL("./crm-metrics.ts", import.meta.url), "utf8");
  assert.equal(metrics.includes("await repairMissingFollowups"), false);
  assert.equal(metrics.includes("scheduleMissingFollowupRepair"), true);
  const crmPage = readFileSync(new URL("../app/crm/page.tsx", import.meta.url), "utf8");
  assert.equal(crmPage.includes("Cargando…"), false);
  assert.equal(crmPage.includes("CrmSkeleton"), true);
  const controls = readFileSync(
    new URL("../components/chat-controls.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(controls.includes("Cómo practicar") || controls.includes("HowToPracticeButton"), true);
});
