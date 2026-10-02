import assert from "node:assert/strict";
import { test } from "node:test";
import { coldHomeBudgetMs } from "./home-load-budget";

test("a cold home load no longer waits on 87 schema statements", () => {
  const budget = coldHomeBudgetMs(40);
  assert.equal(budget.schemaSerial, 87);
  assert.ok(budget.before > 3000);
  assert.ok(budget.after < 500);
  assert.ok(budget.after < budget.before / 5);
});
